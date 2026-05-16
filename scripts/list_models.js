import fetch from 'node-fetch';

async function listModels() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        console.error("GEMINI_API_KEY not found");
        return;
    }
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
}

listModels();
