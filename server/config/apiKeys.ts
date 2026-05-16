import fs from 'fs';
import {
  CONFIG_PATH,
  HEYGEN_CONFIG_PATH,
  RUNWAY_CONFIG_PATH,
  GEMINI_CONFIG_PATH,
  ASSEMBLYAI_CONFIG_PATH,
  ZAPCAP_CONFIG_PATH,
} from './paths.js';

function readKeyFromFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const config = JSON.parse(content) as { apiKey?: string };
    if (config.apiKey) {
      return config.apiKey.trim().replace(/^["']|["']$/g, '');
    }
  } catch (e) {
    console.error(`[Config] Error reading/parsing ${filePath}:`, e);
  }
  return null;
}

export function getElevenLabsKey(): string | null {
  console.log(`[ElevenLabs Config] Checking for config at: ${CONFIG_PATH}`);
  const fileKey = readKeyFromFile(CONFIG_PATH);
  if (fileKey) {
    console.log(`[ElevenLabs Config] API Key found (starts with: ${fileKey.substring(0, 4)}...)`);
    return fileKey;
  }
  const envKey = process.env.ELEVENLABS_API_KEY ?? process.env.ELEVEN_LABS_API_KEY;
  return envKey ? envKey.trim().replace(/^["']|["']$/g, '') : null;
}

export function getHeyGenKey(): string | null {
  console.log(`[HeyGen Config] Checking for config at: ${HEYGEN_CONFIG_PATH}`);
  const fileKey = readKeyFromFile(HEYGEN_CONFIG_PATH);
  if (fileKey) {
    console.log(`[HeyGen Config] API Key found (starts with: ${fileKey.substring(0, 4)}...)`);
    return fileKey;
  }
  const envKey = process.env.HEYGEN_API_KEY;
  return envKey ? envKey.trim().replace(/^["']|["']$/g, '') : null;
}

export function getGeminiKey(): string | null {
  const fileKey = readKeyFromFile(GEMINI_CONFIG_PATH);
  if (fileKey) {
    console.log(`[Gemini Config] API Key found (starts with: ${fileKey.substring(0, 4)}...)`);
    return fileKey;
  }
  const envKey = process.env.GEMINI_API_KEY;
  return envKey ? envKey.trim().replace(/^["']|["']$/g, '') : null;
}

export function getAssemblyAIKey(): string | null {
  const fileKey = readKeyFromFile(ASSEMBLYAI_CONFIG_PATH);
  if (fileKey) {
    console.log(`[AssemblyAI Config] API Key found (starts with: ${fileKey.substring(0, 4)}...)`);
    return fileKey;
  }
  const envKey = process.env.ASSEMBLYAI_API_KEY;
  return envKey ? envKey.trim().replace(/^["']|["']$/g, '') : null;
}

export function getZapCapKey(): string | null {
  const fileKey = readKeyFromFile(ZAPCAP_CONFIG_PATH);
  if (fileKey) {
    console.log(`[ZapCap Config] API Key found (starts with: ${fileKey.substring(0, 4)}...)`);
    return fileKey;
  }
  const envKey = process.env.ZAPCAP_API_KEY;
  return envKey ? envKey.trim().replace(/^["']|["']$/g, '') : null;
}

export function getRunwayKey(): string | null {
  console.log(`[Runway Config] Checking for config at: ${RUNWAY_CONFIG_PATH}`);
  let key = readKeyFromFile(RUNWAY_CONFIG_PATH);

  if (!key) {
    const envKey = process.env.RUNWAY_API_KEY;
    key = envKey ? envKey.trim() : null;
  }

  if (key) {
    console.log(
      `[Runway Config] API Key found (starts with: ${key.substring(0, 4)}..., length: ${key.length})`
    );
    if (!key.startsWith('r_')) {
      console.warn(
        "[Runway Config] WARNING: Key does not start with 'r_'. Runway Gen-3 keys usually start with 'r_'. If this is an OpenAI key (sk_...), it will NOT work."
      );
    }
  }
  return key;
}
