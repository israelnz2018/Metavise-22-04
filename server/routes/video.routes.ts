import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import admin from 'firebase-admin';
import { GENERATED_DIR } from '../config/paths.js';
import { downloadFile } from '../utils/download.js';
import { processDataError } from '../utils/errorExtractor.js';
import { getFFmpegFilter } from '../services/ffmpegService.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Video');

export const videoRouter = Router();

// POST /api/video/compress
// Downloads, compresses to Full HD via ffmpeg, uploads to Firebase, returns
// a signed URL. Files >= 500MB are compressed; smaller ones return the
// original URL unchanged. Rejects 422 when ffmpeg can't keep 1080p+.
videoRouter.post('/compress', async (req, res) => {
  const { filePath, originalUrl, userId } = req.body;
  if (!filePath || !originalUrl || !userId) {
    return res.status(400).json({ error: 'Faltam parâmetros (filePath, originalUrl, userId)' });
  }

  const localInputPath = path.join(GENERATED_DIR, `input_${Date.now()}.mp4`);
  const localOutputPath = path.join(GENERATED_DIR, `output_${Date.now()}.mp4`);

  try {
    await downloadFile(originalUrl, localInputPath);

    const stats = fs.statSync(localInputPath);
    const sizeInMB = stats.size / (1024 * 1024);

    if (sizeInMB < 500) {
      console.log(
        `[Video Compress] Arquivo pequeno (${sizeInMB.toFixed(2)}MB), ignorando compressão.`
      );
      return res.json({ compressed: false, url: originalUrl });
    }

    console.log(`[Video Compress] Comprimindo arquivo de ${sizeInMB.toFixed(2)}MB...`);

    await new Promise((resolve, reject) => {
      ffmpeg(localInputPath)
        .outputOptions([
          '-c:v libx264',
          '-crf 23',
          '-preset fast',
          '-vf',
          'scale=1920:-2',
          '-c:a aac',
          '-b:a 128k',
          '-movflags +faststart',
        ])
        .save(localOutputPath)
        .on('end', resolve)
        .on('error', reject);
    });

    const getResolution = () =>
      new Promise<{ width: number; height: number }>((resolve, reject) => {
        ffmpeg.ffprobe(localOutputPath, (err, metadata) => {
          if (err) return reject(err);
          const stream = metadata.streams.find((s) => s.codec_type === 'video');
          resolve({ width: stream?.width || 0, height: stream?.height || 0 });
        });
      });

    const { width, height } = await getResolution();
    const isFullHD = width >= 1920 || height >= 1080;

    if (!isFullHD) {
      return res.status(422).json({
        error:
          'Não foi possível processar seu vídeo. O arquivo é muito grande e não conseguimos reduzi-lo mantendo a qualidade Full HD. Por favor, exporte seu vídeo em 1080p e tente novamente.',
      });
    }

    const bucket = admin.storage().bucket();
    const destination = `video/${userId}/${Date.now()}_compressed.mp4`;
    await bucket.upload(localOutputPath, {
      destination,
      metadata: { contentType: 'video/mp4' },
    });

    const file = bucket.file(destination);
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: '03-09-2491',
    });

    res.json({ compressed: true, url });
  } catch (err: any) {
    console.error('[Video Compress] Erro:', err.message);
    res.status(500).json({ error: processDataError(err) });
  } finally {
    if (fs.existsSync(localInputPath)) fs.unlinkSync(localInputPath);
    if (fs.existsSync(localOutputPath)) fs.unlinkSync(localOutputPath);
  }
});

// POST /api/video/split
// Cuts a video into segments at the supplied cutPoints (seconds).
videoRouter.post('/split', async (req, res) => {
  const { videoUrl, cutPoints } = req.body;

  if (!videoUrl || !cutPoints || !Array.isArray(cutPoints)) {
    return res.status(400).json({ error: 'videoUrl and cutPoints array are required.' });
  }

  try {
    const videoId = `video_${Date.now()}`;
    const inputPath = path.join(GENERATED_DIR, `${videoId}_input.mp4`);

    if (videoUrl.startsWith('http')) {
      console.log(`[Video Split] Downloading video from: ${videoUrl}`);
      await downloadFile(videoUrl, inputPath);
    } else if (videoUrl.startsWith('/generated/')) {
      const localPath = path.join(GENERATED_DIR, videoUrl.replace('/generated/', ''));
      if (fs.existsSync(localPath)) {
        fs.copyFileSync(localPath, inputPath);
      } else {
        return res.status(404).json({ error: 'Local video file not found.' });
      }
    } else {
      return res.status(400).json({ error: 'Invalid videoUrl format.' });
    }

    const segments: string[] = [];
    const sortedCuts = [...new Set([0, ...cutPoints])].sort((a, b) => a - b);

    const metadata: any = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) reject(err);
        else resolve(metadata);
      });
    });
    const duration = metadata.format.duration;
    if (sortedCuts[sortedCuts.length - 1] < duration) {
      sortedCuts.push(duration);
    }

    console.log(`[Video Split] Start Points:`, sortedCuts);
    console.log(`[Video Split] Duration: ${duration}`);
    console.log(`[Video Split] Splitting into ${sortedCuts.length - 1} segments...`);

    for (let i = 0; i < sortedCuts.length - 1; i++) {
      const start = sortedCuts[i];
      const end = sortedCuts[i + 1];
      const segmentDuration = end - start;

      if (segmentDuration < 0.1) {
        console.log(`[Video Split] Skipping tiny segment ${i}: ${segmentDuration}s`);
        continue;
      }

      const segmentFilename = `${videoId}_segment_${i}.mp4`;
      const outputPath = path.join(GENERATED_DIR, segmentFilename);

      console.log(
        `[Video Split] Creating segment ${i}: ${start}s to ${end}s (dur: ${segmentDuration}s)`
      );

      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .inputOptions('-accurate_seek')
          .setStartTime(start)
          .setDuration(segmentDuration)
          .outputOptions([
            '-c:v libx264',
            '-preset superfast',
            '-crf 23',
            '-c:a aac',
            '-b:a 128k',
            '-pix_fmt yuv420p',
            '-movflags +faststart',
          ])
          .output(outputPath)
          .on('end', () => {
            console.log(`[Video Split] Segment ${i} finished: ${segmentFilename}`);
            resolve(true);
          })
          .on('error', (err) => {
            console.error(`[Video Split] Segment ${i} failed:`, err);
            reject(err);
          })
          .run();
      });

      segments.push(`/generated/${segmentFilename}`);
    }

    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);

    res.json({ segments });
  } catch (err: any) {
    console.error('[Video Split] CRITICAL ERROR:', err);
    res.status(500).json({ error: `Video split failed: ${err.message}` });
  }
});

// POST /api/video/assemble
// Stitches the main avatar video with B-roll inserts on a timeline.
videoRouter.post('/assemble', async (req, res) => {
  const { originalVideoUrl, timelineEdits, aspectRatio, duration, avatarCropOffset } = req.body;

  if (!originalVideoUrl || !timelineEdits || !Array.isArray(timelineEdits)) {
    return res.status(400).json({ error: 'Missing required parameters.' });
  }

  try {
    const assemblyId = `assemble_${Date.now()}`;
    const workDir = path.join(GENERATED_DIR, assemblyId);
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir);

    const mainVideoPath = path.join(workDir, 'main_original.mp4');
    const mainAudioPath = path.join(workDir, 'main_audio.aac');

    console.log(
      `[Video Assemble] Starting assembly ${assemblyId} with cropOffset: ${avatarCropOffset || 0}`
    );

    await downloadFile(originalVideoUrl, mainVideoPath);

    // Extract the original audio so we can re-mux it onto the stitched visual.
    await new Promise((resolve, reject) => {
      ffmpeg(mainVideoPath)
        .outputOptions('-vn', '-acodec aac', '-b:a 128k')
        .output(mainAudioPath)
        .on('end', resolve)
        .on('error', (err) => {
          console.error('[Assemble] Audio extraction failed:', err);
          reject(err);
        })
        .run();
    });

    const assemblyFilter = getFFmpegFilter(aspectRatio, avatarCropOffset || 0);
    const brollFilter = getFFmpegFilter(aspectRatio, 0);

    const sortedEdits = [...timelineEdits].sort((a, b) => a.timestamp - b.timestamp);
    const segmentsToJoin: string[] = [];
    let lastTime = 0;

    for (let i = 0; i < sortedEdits.length; i++) {
      const edit = sortedEdits[i];

      // Avatar gap before this B-roll.
      if (edit.timestamp > lastTime) {
        const gapDuration = edit.timestamp - lastTime;
        const segmentPath = path.join(workDir, `seg_avatar_${i}.mp4`);
        await new Promise((resolve, reject) => {
          ffmpeg(mainVideoPath)
            .setStartTime(lastTime)
            .setDuration(gapDuration)
            .videoFilters(assemblyFilter)
            .outputOptions([
              '-c:v libx264',
              '-preset superfast',
              '-an',
              '-pix_fmt yuv420p',
              '-r 30',
            ])
            .output(segmentPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        });
        segmentsToJoin.push(segmentPath);
      }

      // The B-roll (VEO / Runway / similar).
      if (edit.videoUrl) {
        const veoInputPath = path.join(workDir, `seg_veo_input_${i}.mp4`);
        const veoSegmentPath = path.join(workDir, `seg_veo_${i}.mp4`);

        await downloadFile(edit.videoUrl, veoInputPath);

        await new Promise((resolve, reject) => {
          ffmpeg(veoInputPath)
            .setDuration(edit.duration || 4)
            .outputOptions([
              '-c:v libx264',
              '-preset superfast',
              '-an',
              '-pix_fmt yuv420p',
              '-r 30',
            ])
            .videoFilters(brollFilter)
            .output(veoSegmentPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        });
        segmentsToJoin.push(veoSegmentPath);
        lastTime = edit.timestamp + (edit.duration || 4);
      }
    }

    // Final avatar gap from lastTime to the requested total duration.
    const totalDuration = duration || 60;
    if (lastTime < totalDuration) {
      const gapDuration = totalDuration - lastTime;
      if (gapDuration > 0.1) {
        const segmentPath = path.join(workDir, `seg_avatar_final.mp4`);
        await new Promise((resolve, reject) => {
          ffmpeg(mainVideoPath)
            .setStartTime(lastTime)
            .setDuration(gapDuration)
            .videoFilters(assemblyFilter)
            .outputOptions([
              '-c:v libx264',
              '-preset superfast',
              '-an',
              '-pix_fmt yuv420p',
              '-r 30',
            ])
            .output(segmentPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        });
        segmentsToJoin.push(segmentPath);
      }
    }

    const concatListPath = path.join(workDir, 'concat_list.txt');
    const listContent = segmentsToJoin.map((p) => `file '${p}'`).join('\n');
    fs.writeFileSync(concatListPath, listContent);

    const silentVideoPath = path.join(workDir, 'merged_visual.mp4');
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions(['-c:v libx264', '-pix_fmt yuv420p'])
        .output(silentVideoPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    // Re-merge the original audio.
    const finalFilename = `assembled_${Date.now()}.mp4`;
    const finalOutputPath = path.join(GENERATED_DIR, finalFilename);

    await new Promise((resolve, reject) => {
      ffmpeg(silentVideoPath)
        .input(mainAudioPath)
        .outputOptions(['-c:v copy', '-c:a aac', '-map 0:v:0', '-map 1:a:0', '-shortest'])
        .output(finalOutputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    res.json({ url: `/generated/${finalFilename}` });
  } catch (err: any) {
    console.error('[Video Assemble] Error:', err);
    res.status(500).json({ error: `Assembly failed: ${err.message}` });
  }
});

// POST /api/video/crop
// Crops/scales a single video to the target aspect ratio.
videoRouter.post('/crop', async (req, res) => {
  const { videoUrl, aspectRatio, cropOffset } = req.body;

  if (!videoUrl) return res.status(400).json({ error: 'videoUrl is required.' });

  log.info('crop request', {
    videoUrl: videoUrl.substring(0, 60),
    aspectRatio,
    cropOffset,
  });

  try {
    const videoId = `crop_${Date.now()}`;
    const inputPath = path.join(GENERATED_DIR, `${videoId}_input.mp4`);
    const outputPath = path.join(GENERATED_DIR, `${videoId}_final.mp4`);

    await downloadFile(videoUrl, inputPath);

    const filter = getFFmpegFilter(aspectRatio || '1:1', cropOffset || 0);

    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoFilters(filter)
        .outputOptions([
          '-c:v libx264',
          '-preset superfast',
          '-crf 23',
          '-c:a aac',
          '-b:a 128k',
          '-pix_fmt yuv420p',
          '-movflags +faststart',
        ])
        .output(outputPath)
        .on('end', () => resolve(null))
        .on('error', (err) => {
          log.error('ffmpeg crop failed:', err);
          reject(err);
        })
        .run();
    });

    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    res.json({ url: `/generated/${videoId}_final.mp4` });
  } catch (err: any) {
    log.error('crop failed:', err.message);
    res.status(500).json({ error: `Crop failed: ${err.message}` });
  }
});

// POST /api/video/render-scenes
// Renders a multi-scene timeline (avatar/text/image/runway scenes) and
// optionally layers voice + background music + subtitles.
videoRouter.post('/render-scenes', async (req, res) => {
  const {
    scenes,
    audioUrl,
    bgmUrl,
    aspectRatio,
    originalVideoUrl,
    subtitlesEnabled,
    subFontSize: _subFontSize,
    subVerticalPos: _subVerticalPos,
    subColor: _subColor,
  } = req.body;

  if (!scenes || !Array.isArray(scenes)) {
    return res.status(400).json({ error: 'Missing scenes array.' });
  }

  try {
    const renderId = `render_${Date.now()}`;
    const workDir = path.join(GENERATED_DIR, renderId);
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir);

    const mainAvatarVideoPath = path.join(workDir, 'avatar_source.mp4');
    if (originalVideoUrl) {
      await downloadFile(originalVideoUrl, mainAvatarVideoPath);
    }

    const segmentPaths: string[] = [];
    const resWidth = aspectRatio === '16:9' ? 1920 : aspectRatio === '1:1' ? 1080 : 1080;
    const resHeight = aspectRatio === '16:9' ? 1080 : aspectRatio === '1:1' ? 1080 : 1920;

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const segPath = path.join(workDir, `scene_${i}.mp4`);

      if (scene.type === 'avatar' && originalVideoUrl) {
        await new Promise((resolve, reject) => {
          const cmd = ffmpeg(mainAvatarVideoPath)
            .setStartTime(scene.settings.trimStart || 0)
            .setDuration(scene.duration)
            .outputOptions([
              '-c:v libx264',
              '-preset superfast',
              '-an',
              '-pix_fmt yuv420p',
              '-r 30',
            ]);

          let filter = `scale=${resWidth}:${resHeight}:force_original_aspect_ratio=decrease,pad=${resWidth}:${resHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
          if (scene.settings.transition === 'fade') {
            filter += `,fade=in:st=0:d=1`;
          }
          cmd.videoFilters(filter);
          cmd.output(segPath).on('end', resolve).on('error', reject).run();
        });
      } else if (scene.type === 'text') {
        await new Promise((resolve, reject) => {
          const color = scene.settings.backgroundColor || 'black';
          const text = scene.settings.text || '';
          const fontSize = scene.settings.fontSize || 60;

          const filters: any[] = [
            {
              filter: 'drawtext',
              options: {
                text: text,
                fontcolor: 'white',
                fontsize: fontSize,
                x: '(w-text_w)/2',
                y:
                  scene.settings.textPosition === 'top'
                    ? 'h*0.2'
                    : scene.settings.textPosition === 'bottom'
                      ? 'h*0.8'
                      : '(h-text_h)/2',
              },
            },
          ];

          if (scene.settings.transition === 'fade') {
            filters.push('fade=in:st=0:d=1');
          }

          ffmpeg(`color=c=${color}:s=${resWidth}x${resHeight}:d=${scene.duration}`)
            .inputFormat('lavfi')
            .videoFilters(filters)
            .outputOptions([
              '-c:v libx264',
              '-preset superfast',
              '-an',
              '-pix_fmt yuv420p',
              '-r 30',
            ])
            .output(segPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        });
      } else if (scene.type === 'image' && scene.settings.imageUrl) {
        const imgPath = path.join(workDir, `img_${i}.jpg`);
        await downloadFile(scene.settings.imageUrl, imgPath);
        await new Promise((resolve, reject) => {
          let filter = `scale=${resWidth}:${resHeight}:force_original_aspect_ratio=decrease,pad=${resWidth}:${resHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
          if (scene.settings.transition === 'fade') {
            filter += `,fade=in:st=0:d=1`;
          }
          ffmpeg(imgPath)
            .loop(scene.duration)
            .videoFilters(filter)
            .outputOptions([
              '-c:v libx264',
              '-preset superfast',
              '-an',
              '-pix_fmt yuv420p',
              '-r 30',
            ])
            .output(segPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        });
      } else if (scene.type === 'runway' && scene.settings.videoUrl) {
        const runwayInputPath = path.join(workDir, `runway_input_${i}.mp4`);
        await downloadFile(scene.settings.videoUrl, runwayInputPath);
        await new Promise((resolve, reject) => {
          let filter = `scale=${resWidth}:${resHeight}:force_original_aspect_ratio=decrease,pad=${resWidth}:${resHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
          if (scene.settings.transition === 'fade') {
            filter += `,fade=in:st=0:d=1`;
          }
          ffmpeg(runwayInputPath)
            .setDuration(scene.duration)
            .outputOptions([
              '-c:v libx264',
              '-preset superfast',
              '-an',
              '-pix_fmt yuv420p',
              '-r 30',
            ])
            .videoFilters(filter)
            .output(segPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        });
      }

      if (fs.existsSync(segPath)) {
        segmentPaths.push(segPath);
      }
    }

    // Concatenate all scenes into a single video track.
    const concatListPath = path.join(workDir, 'concat_list.txt');
    const listContent = segmentPaths.map((p) => `file '${p}'`).join('\n');
    fs.writeFileSync(concatListPath, listContent);

    const visualPath = path.join(workDir, 'visual_only.mp4');
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions(['-c:v libx264', '-pix_fmt yuv420p'])
        .output(visualPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    const finalFilename = `rendered_${Date.now()}.mp4`;
    const finalPath = path.join(GENERATED_DIR, finalFilename);

    if (audioUrl) {
      const voicePath = path.join(workDir, 'voice_audio.mp3');
      await downloadFile(audioUrl, voicePath);

      let bgmPath = '';
      if (bgmUrl) {
        bgmPath = path.join(workDir, 'bgm_audio.mp3');
        await downloadFile(bgmUrl, bgmPath);
      }

      await new Promise((resolve, reject) => {
        const cmd = ffmpeg(visualPath).input(voicePath);

        if (bgmPath) {
          cmd.input(bgmPath);
          cmd.complexFilter([
            '[1:a]volume=1.0[v]',
            '[2:a]volume=0.1,aloop=loop=-1:size=2e+09[bg]',
            '[v][bg]amix=inputs=2:duration=first[a]',
          ]);
          cmd.outputOptions(['-map 0:v:0', '-map [a]', '-c:v copy', '-c:a aac', '-shortest']);
        } else {
          cmd.outputOptions(['-c:v copy', '-c:a aac', '-map 0:v:0', '-map 1:a:0', '-shortest']);
        }

        if (subtitlesEnabled) {
          console.log(
            '[Render] Subtitles enabled but complex burning skipped due to missing timing data.'
          );
        }

        cmd.output(finalPath).on('end', resolve).on('error', reject).run();
      });
    } else {
      fs.copyFileSync(visualPath, finalPath);
    }

    res.json({ url: `/generated/${finalFilename}` });
  } catch (err: any) {
    console.error('[Render Scenes] Error:', err);
    res.status(500).json({ error: err.message });
  }
});
