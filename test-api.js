async function test() {
  const res = await fetch('http://localhost:3000/api/zapcap/edit-simple', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoUrl: 'foo', templateId: 'bar' })
  });
  console.log('Status:', res.status);
  console.log('Content-Type:', res.headers.get('content-type'));
  const text = await res.text();
  console.log('Body snippet:', text.substring(0, 100));
}
test();
