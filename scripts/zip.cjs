const fs = require('fs');
const archiver = require('archiver');
const ignore = require('ignore');

const output = fs.createWriteStream(__dirname + '/../public/codigo-fonte.zip');
const archive = archiver('zip', {
  zlib: { level: 9 } // Sets the compression level.
});

output.on('close', function() {
  console.log(archive.pointer() + ' total bytes');
  console.log('archiver has been finalized and the output file descriptor has closed.');
});

archive.on('warning', function(err) {
  if (err.code === 'ENOENT') {
    console.warn(err);
  } else {
    throw err;
  }
});

archive.on('error', function(err) {
  throw err;
});

archive.pipe(output);

const ig = ignore().add(['node_modules', 'dist', '.git', 'public/codigo-fonte.tar.gz', 'public/codigo-fonte.zip']);

function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = dir + '/' + file;
        const relPath = fullPath.replace('./', '');
        
        if (ig.ignores(relPath)) continue;

        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            walkDir(fullPath);
        } else {
            archive.file(fullPath, { name: relPath });
        }
    }
}

walkDir('.');

archive.finalize();
