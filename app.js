// exitNotion/app.js
// Main logic for exNotion Link Cleaner PWA

const dropArea = document.getElementById('drop-area');
const fileElem = document.getElementById('fileElem');
const progressArea = document.getElementById('progress-area');
const downloadBtn = document.getElementById('downloadBtn');

defaultExportFolderPattern = /^Export-[a-f0-9\-]+/i;
const CLEANED_ROOT = 'exNotion-Cleaned';

let cleanedZipBlob = null;

function showStatus(msg, type = 'info') {
  progressArea.innerHTML = `<div class="alert alert-${type} py-2 mb-0">${msg}</div>`;
}

function showFileList(files, changedFiles, mdCount) {
  let html = `<div class="alert alert-info py-2 mb-2">Processed <b>${files.length}</b> files.`;
  if (mdCount === 0) {
    html += ` <span class='text-danger'>No .md files found!</span>`;
  }
  html += `</div><ul class="list-group small mb-2">`;
  for (const f of files) {
    const changed = changedFiles.has(f) ? 'list-group-item-success' : '';
    html += `<li class="list-group-item ${changed}">${f}${changed ? ' <span class=\'badge bg-success\'>updated</span>' : ''}</li>`;
  }
  html += '</ul>';
  progressArea.innerHTML = html;
}

function clearStatus() {
  progressArea.innerHTML = '';
}

function cleanName(name) {
  // Remove ' [32hex]' from folder/file names (space or %20)
  let cleaned = name.replace(/( |%20)[0-9a-fA-F]{32}/g, '');
  // Replace Notion/Obsidian export root folder/zip name with exNotion-Cleaned
  cleaned = cleaned.replace(defaultExportFolderPattern, CLEANED_ROOT);
  if (cleaned !== name) console.log(`Renamed: '${name}' -> '${cleaned}'`);
  return cleaned;
}

function updateLinksInMarkdown(content, filePath) {
  // Replace FolderName HASH/filename and FolderName%20HASH/filename with FolderName/filename
  const folderHashPattern = /(([^\/]+)\s[0-9a-fA-F]{32})\/([^\)\]\s]+)/g;
  const folderHashUrlencPattern = /(([^\/]+)%20[0-9a-fA-F]{32})\/([^\)\]\s]+)/g;
  let updated = content.replace(folderHashPattern, (m, _full, folder, filename) => `${folder}/${filename}`);
  updated = updated.replace(folderHashUrlencPattern, (m, _full, folder, filename) => `${folder}/${filename}`);
  if (updated !== content) console.log(`Updated links in: ${filePath}`);
  return updated;
}

async function extractNestedZip(zip, parentPath = '') {
  // Recursively extract all files from zip, including nested zips
  let files = {};
  for (const [path, zipEntry] of Object.entries(zip.files)) {
    let cleanedPath = path.split('/').map(cleanName).join('/');
    const fullPath = parentPath ? parentPath + '/' + cleanedPath : cleanedPath;
    if (zipEntry.dir) continue;
    if (path.toLowerCase().endsWith('.zip')) {
      // Nested zip: extract and recurse
      console.log(`Found nested zip: ${fullPath}`);
      const nestedData = await zipEntry.async('uint8array');
      const nestedZip = await JSZip.loadAsync(nestedData);
      // Clean the nested zip folder name as well
      const nestedFolder = fullPath.replace(/\.zip$/i, '');
      const cleanedNestedFolder = cleanName(nestedFolder);
      const nestedFiles = await extractNestedZip(nestedZip, cleanedNestedFolder);
      Object.assign(files, nestedFiles);
    } else {
      files[fullPath] = zipEntry;
    }
  }
  return files;
}

async function processZip(file) {
  showStatus('Reading zip file...', 'info');
  const zip = await JSZip.loadAsync(file);
  // Recursively extract all files, including from nested zips
  const allZipEntries = await extractNestedZip(zip);
  const newZip = new JSZip();
  let fileCount = 0;
  let mdCount = 0;
  let allFiles = [];
  let changedFiles = new Set();

  // Build a map of old path -> new path for all files/folders
  const pathMap = {};
  Object.keys(allZipEntries).forEach(path => {
    const parts = path.split('/').map(cleanName);
    const newPath = parts.join('/');
    pathMap[path] = newPath;
  });

  // Process all files
  for (const [oldPath, zipEntry] of Object.entries(allZipEntries)) {
    fileCount++;
    let newPath = pathMap[oldPath];
    allFiles.push(newPath);
    let content = await zipEntry.async('uint8array');
    let isMarkdown = newPath.toLowerCase().endsWith('.md') || newPath.toLowerCase().endsWith('.markdown');
    let changed = false;
    if (isMarkdown) {
      mdCount++;
      let text = new TextDecoder('utf-8').decode(content);
      let updated = updateLinksInMarkdown(text, newPath);
      if (updated !== text) changed = true;
      content = new TextEncoder().encode(updated);
    }
    if (oldPath !== newPath) changed = true;
    if (changed) changedFiles.add(newPath);
    newZip.file(newPath, content);
    console.log(`Processed: ${oldPath} -> ${newPath}`);
  }

  showFileList(allFiles, changedFiles, mdCount);
  cleanedZipBlob = await newZip.generateAsync({ type: 'blob' });
  downloadBtn.style.display = '';
  if (mdCount === 0) {
    showStatus('No .md files found! Please check your zip structure.', 'warning');
  } else {
    showStatus(`Processed ${fileCount} files. ${changedFiles.size} files/links updated.`, 'success');
  }
}

// Drag and drop handlers
['dragenter', 'dragover'].forEach(eventName => {
  dropArea.addEventListener(eventName, e => {
    e.preventDefault();
    e.stopPropagation();
    dropArea.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach(eventName => {
  dropArea.addEventListener(eventName, e => {
    e.preventDefault();
    e.stopPropagation();
    dropArea.classList.remove('dragover');
  });
});
dropArea.addEventListener('drop', e => {
  const files = e.dataTransfer.files;
  if (files.length) {
    handleFile(files[0]);
  }
});
fileElem.addEventListener('change', e => {
  if (fileElem.files.length) {
    handleFile(fileElem.files[0]);
  }
});

downloadBtn.addEventListener('click', () => {
  if (cleanedZipBlob) {
    const url = URL.createObjectURL(cleanedZipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'exNotion-Cleaned.zip';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }
});

function handleFile(file) {
  if (!file.name.endsWith('.zip')) {
    showStatus('Please upload a .zip file.', 'danger');
    return;
  }
  downloadBtn.style.display = 'none';
  cleanedZipBlob = null;
  processZip(file).catch(err => {
    showStatus('Error processing zip: ' + err, 'danger');
    console.error(err);
  });
} 