// Cria o Criativo 16 clonando a estrutura do Criativo 1 (brief_1) e trocando
// gancho + roteiro (4 blocos), zerando toda a mídia gerada do Criativo 1.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const appletConfig = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const serviceAccount = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url)));
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app, appletConfig.firestoreDatabaseId);

const PROJECT_ID = 'BNOpVXZ3kD5DLsKYEyBl';
const NEW_ID = 'brief_16';

const NEW_HOOK =
  "Here's the REAL reason the burning in your feet won't stop at night — and it's not aging, it's not poor circulation, and it's not 'just nerve damage.'";

const NEW_SCRIPT = `[REVELAÇÃO INESPERADA]
The burning in your feet at 3am isn't aging. It isn't poor circulation. And no matter how many specialists shrugged and told you to "just live with it" — it isn't simple nerve damage either. Sit with that for a second. You've done the painkillers. You've sat through the injections. You've stretched, iced, soaked, and bought every cream the pharmacy sells. And still — the moment your head hits the pillow, the electric jolts come back. The pins and needles crawl up your calves. Your hands feel like they belong to somebody else. Here's what nobody on that long, exhausting list of appointments ever told you: the reason none of it worked has almost nothing to do with what you've been treating. The pain in your feet, your legs, your fingertips isn't really starting where you think it is. There's a specific signal firing inside your body, quietly, every single hour — and the standard treatments were never built to touch it. They calm the surface. They mask the noise. They buy you a few hours of fragile quiet before it screams back to life. But the real trigger sits one layer underneath everything you've already tried.

[LOOP DE CURIOSIDADE]
Think about how strange this is. Two people, same age, same lifestyle — one sleeps through the night, the other can't stand long enough to finish the dishes. If it were just "old age," both would suffer equally. They don't. Something else is going on. What researchers have found is that there's a conversation happening between your nerves and one specific molecule your own body produces — an inflammatory molecule that, when it slips out of balance, jams that pain signal in the "on" position. The burning doesn't stop. The tingling doesn't stop. That shooting feeling from your heel to your knee doesn't stop. That's why painkillers feel like they work from the outside in instead of fixing anything. That's why the injections wore off faster the second time, and faster again the third. None of them were ever aimed at that molecule. And here's the hard part: most family doctors aren't told about it either — not because it's rare, but because there's no patent on pointing it out. So millions of people in their 60s and 70s keep cycling through the same waiting rooms, getting the same shrug, and quietly start believing their independence has an expiration date. It doesn't. If you're over 55, you've had this for months or years, and you've already tried everything they handed you — this is exactly the piece you were never given.

[PONTE PARA O VÍDEO]
The person who finally connected these dots is Dr. Richard Moore — an orthopedist with more than fifteen years inside this exact problem. He didn't go looking for the answer for a paper or a patent. He went looking because someone in his own family was the one waking up at 3am. In a short presentation on the next page, he names that misfiring molecule directly, shows why the standard playbook keeps sliding right past it, and walks through what actually changes when you treat the source instead of the surface. He pulls up the research that turned his own thinking around, and reads back what his patients told him in their own words. I'm keeping the details off this page on purpose — the order he walks you through it in is what makes the whole thing finally click, and it lands far better coming from him.

[CTA SUAVE]
Tap below to watch Dr. Moore's presentation while it's still up. It isn't a 30-second clip — he takes his time and explains it properly, from the beginning, so give yourself a few quiet minutes, sit somewhere comfortable, and hear him out the whole way through. If you've been carrying this in your feet, your legs, or your hands for years, this is worth the time it takes to finally understand why.`;

const variantsCol = db.collection('projects').doc(PROJECT_ID).collection('variants');

// guarda: não sobrescrever se já existir
const existing = await variantsCol.doc(NEW_ID).get();
if (existing.exists) {
  console.log(`!! ${NEW_ID} já existe. Abortando para não sobrescrever.`);
  process.exit(1);
}

const base = (await variantsCol.doc('brief_1').get()).data();
if (!base) { console.log('brief_1 não encontrado'); process.exit(1); }

// clone profundo
const v = JSON.parse(JSON.stringify(base));

// identidade
v.id = NEW_ID;
v.name = 'Criativo 16 - Consc.3 - Autoridade (Gancho v2)';
v.createdAt = new Date().toISOString();
v.status = 'brief_only';
if (v.brief) { v.brief.id = NEW_ID; v.brief.index = 16; }

// roteiro novo + gancho novo
const c = v.config.copy;
c.generatedScript = NEW_SCRIPT;
c.hookOptimizedScript = NEW_HOOK;
c.hookSelecionado = NEW_HOOK;
c.optimizedScript = '';   // força reotimização de voz a partir do novo roteiro
c.finalScript = '';

// zera mídia/áudio/vídeo herdados do Criativo 1 (a nível de config)
v.config.videoUrl = null;
v.config.videoStoragePath = null;
v.config.videos = [];
v.config.lastVideoMetadata = null;
v.config.generationStage = 'idle';
v.config.audioUrl = null;
v.config.audioStoragePath = null;
v.config.audios = [];

// zera mídia de hook herdada (a nível de copy)
c.hookAudioStoragePath = null;
c.hookAudioUrl = null;
c.hookVideoUrl = '';
c.hookVideoStoragePath = null;
c.hookAudios = [];
c.hookVideos = [];
c.history = [];
c.hooksHistorico = [];

await variantsCol.doc(NEW_ID).set(v);

console.log('OK — criado', NEW_ID);
console.log('  name:', v.name);
console.log('  createdAt:', v.createdAt);
console.log('  brief.id:', v.brief?.id, '| activeBriefId:', c.activeBriefId);
console.log('  generationStage:', v.config.generationStage, '| status:', v.status);
console.log('  hook:', c.hookOptimizedScript.slice(0, 60) + '...');
console.log('  generatedScript chars:', c.generatedScript.length);
process.exit(0);
