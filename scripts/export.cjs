const fs = require('fs');
const { execSync } = require('child_process');

if (!fs.existsSync('./public')) {
    fs.mkdirSync('./public');
}

let fileName = 'codigo-fonte.zip';
try {
    console.log('Tentando compactar usando ZIP...');
    execSync('zip -r public/codigo-fonte.zip . -x "*node_modules*" -x "*.git*" -x "*dist*"');
    console.log('ZIP criado com sucesso.');
} catch (e) {
    console.log('Comando ZIP falhou. Tentando com TAR...');
    fileName = 'codigo-fonte.tar.gz';
    execSync('tar -czf public/codigo-fonte.tar.gz --exclude=node_modules --exclude=dist --exclude=.git --exclude=.next .');
    console.log('TAR.GZ criado com sucesso.');
}

console.log('GERADO:' + fileName);
