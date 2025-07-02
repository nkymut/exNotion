// exitNotion/app.js
// Main logic for exNotion Link Cleaner PWA

// Debug flag - set to false for production deployment
const _DEBUG = false;

// Debug logging wrapper
function debugLog(...args) {
  if (_DEBUG) {
    console.log(...args);
  }
}

function debugError(...args) {
  if (_DEBUG) {
    console.error(...args);
  }
}

function debugWarn(...args) {
  if (_DEBUG) {
    console.warn(...args);
  }
}

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
  if (cleaned !== name) debugLog(`Renamed: '${name}' -> '${cleaned}'`);
  return cleaned;
}

function updateLinksInMarkdown(content, filePath) {
  debugLog(`=== Processing ${filePath} ===`);
  debugLog(`Original content length: ${content.length}`);
  
  if (content.length === 0) {
    debugError(`INPUT CONTENT IS EMPTY for: ${filePath}`);
    return content;
  }
  
  debugLog(`First 200 chars: "${content.substring(0, 200)}"`);
  
  const original = content;
  
  // Replace FolderName HASH/filename and FolderName%20HASH/filename with FolderName/filename
  const folderHashPattern = /(([^\/]+)\s[0-9a-fA-F]{32})\/([^\)\]\s]+)/g;
  const folderHashUrlencPattern = /(([^\/]+)%20[0-9a-fA-F]{32})\/([^\)\]\s]+)/g;
  let updated = content.replace(folderHashPattern, (m, _full, folder, filename) => `${folder}/${filename}`);
  updated = updated.replace(folderHashUrlencPattern, (m, _full, folder, filename) => `${folder}/${filename}`);
  
  // Remove hashes from the end of filenames in links (e.g., filename%20HASH.md -> filename.md)
  const filenameHashPattern = /([^\s\)]+?)(%20|\s)[0-9a-fA-F]{32}(\.md|\.markdown)/g;
  updated = updated.replace(filenameHashPattern, (match, filename, space, extension) => {
    // Keep URL encoding for spaces in filenames
    const cleanFilename = filename.replace(/\s/g, '%20');
    return `${cleanFilename}${extension}`;
  });
  
  // Remove hashes from anywhere in filenames in links (e.g., filename%20HASH%20more.md -> filename more.md)
  const filenameHashAnywherePattern = /([^\s\(\)\[\]]+?)(%20|\s)[0-9a-fA-F]{32}([^\s\(\)\[\]]*)(\.md|\.markdown)/g;
  updated = updated.replace(filenameHashAnywherePattern, (match, beforeHash, space, afterHash, extension) => {
    // Keep URL encoding for spaces
    const cleanBefore = beforeHash.replace(/\s/g, '%20');
    const cleanAfter = afterHash ? afterHash.replace(/\s/g, '%20') : '';
    return `${cleanBefore}${cleanAfter}${extension}`;
  });
  
  // Comprehensive pattern: Remove hashes from filenames in markdown links and keep URL encoding
  const comprehensiveHashPattern = /\[([^\]]+)\]\(([^)]+?)(%20|\s)[0-9a-fA-F]{32}([^)]*?)(\.md|\.markdown)\)/g;
  updated = updated.replace(comprehensiveHashPattern, (match, linkText, pathBefore, space, pathAfter, extension) => {
    // Keep URL encoding for spaces in paths
    const cleanPathBefore = pathBefore.replace(/\s/g, '%20');
    const cleanPathAfter = pathAfter ? pathAfter.replace(/\s/g, '%20') : '';
    const cleanPath = `${cleanPathBefore}${cleanPathAfter}${extension}`;
    return `[${linkText}](${cleanPath})`;
  });
  
  // Remove hashes from tags (e.g., #tag 1234567890abcdef -> #tag)
  const tagHashPattern = /#([^\s]+)\s[0-9a-fA-F]{32}/g;
  updated = updated.replace(tagHashPattern, '#$1');
  
  debugLog(`Updated content length: ${updated.length}`);
  debugLog(`First 200 chars after update: "${updated.substring(0, 200)}"`);
  
  if (updated.length === 0 && original.length > 0) {
    debugError(`CONTENT BECAME EMPTY during processing: ${filePath}`);
    debugError(`Original had ${original.length} chars, now has ${updated.length} chars`);
  }
  
  if (updated !== original) {
    debugLog(`Updated links/tags in: ${filePath}`);
    debugLog(`Content length changed: ${original.length} -> ${updated.length}`);
  } else {
    debugLog(`No changes needed in: ${filePath}`);
  }
  
  return updated;
}

async function extractNestedZip(zip, parentPath = '') {
  // Recursively extract all files from zip, including nested zips
  let files = {};
  debugLog(`\nExtracting zip at path: "${parentPath}"`);
  debugLog(`Found ${Object.keys(zip.files).length} entries in zip`);
  
  for (const [path, zipEntry] of Object.entries(zip.files)) {
    let cleanedPath = path.split('/').map(cleanName).join('/');
    const fullPath = parentPath ? parentPath + '/' + cleanedPath : cleanedPath;
    
    if (zipEntry.dir) {
      debugLog(`Directory: ${fullPath}`);
      continue;
    }
    
    debugLog(`File found: ${path} -> ${fullPath}`);
    
    if (path.toLowerCase().endsWith('.zip')) {
      // Nested zip: extract and recurse
      debugLog(`Found nested zip: ${fullPath}`);
      const nestedData = await zipEntry.async('uint8array');
      debugLog(`Nested zip size: ${nestedData.length} bytes`);
      
      const nestedZip = await JSZip.loadAsync(nestedData);
      // Clean the nested zip folder name as well
      const nestedFolder = fullPath.replace(/\.zip$/i, '');
      const cleanedNestedFolder = cleanName(nestedFolder);
      debugLog(`Extracting nested zip to folder: ${cleanedNestedFolder}`);
      
      const nestedFiles = await extractNestedZip(nestedZip, cleanedNestedFolder);
      Object.assign(files, nestedFiles);
    } else {
      // Check file size for markdown files
      if (path.toLowerCase().endsWith('.md') || path.toLowerCase().endsWith('.markdown')) {
        const size = zipEntry._data ? zipEntry._data.compressedSize : 'unknown';
        debugLog(`Markdown file: ${fullPath} (compressed size: ${size})`);
      }
      files[fullPath] = zipEntry;
    }
  }
  
  debugLog(`Extracted ${Object.keys(files).length} files from this zip level`);
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
  const pathCounts = {};
  
  Object.keys(allZipEntries).forEach(path => {
    const parts = path.split('/').map(cleanName);
    let newPath = parts.join('/');
    
    // Handle naming conflicts by adding a counter
    const originalNewPath = newPath;
    let counter = 1;
    
    // Check for conflicts (both exact matches and file vs folder conflicts)
    while (Object.values(pathMap).includes(newPath) || 
           Object.values(pathMap).some(existingPath => {
             const pathWithoutExt = newPath.replace(/\.[^/.]+$/, '');
             const existingWithoutExt = existingPath.replace(/\.[^/.]+$/, '');
             return pathWithoutExt === existingWithoutExt && pathWithoutExt !== newPath && existingWithoutExt !== existingPath;
           })) {
      
      // Add counter before file extension or at the end
      const lastDotIndex = originalNewPath.lastIndexOf('.');
      if (lastDotIndex > originalNewPath.lastIndexOf('/')) {
        // Has extension
        const namepart = originalNewPath.substring(0, lastDotIndex);
        const extension = originalNewPath.substring(lastDotIndex);
        newPath = `${namepart}_${counter}${extension}`;
      } else {
        // No extension
        newPath = `${originalNewPath}_${counter}`;
      }
      counter++;
    }
    
    if (newPath !== originalNewPath) {
      debugLog(`Resolved naming conflict: ${originalNewPath} -> ${newPath}`);
    }
    
    pathMap[path] = newPath;
  });

  // Process all files
  for (const [oldPath, zipEntry] of Object.entries(allZipEntries)) {
    fileCount++;
    let newPath = pathMap[oldPath];
    allFiles.push(newPath);
    
    debugLog(`\n--- Processing file ${fileCount}: ${oldPath} ---`);
    debugLog(`New path: ${newPath}`);
    
    let content = await zipEntry.async('uint8array');
    debugLog(`Raw content size: ${content.length} bytes`);
    
    let isMarkdown = newPath.toLowerCase().endsWith('.md') || newPath.toLowerCase().endsWith('.markdown');
    let changed = false;
    
    if (isMarkdown) {
      mdCount++;
      debugLog(`Processing markdown file: ${newPath}`);
      
      let text = new TextDecoder('utf-8').decode(content);
      debugLog(`Decoded text length: ${text.length} characters`);
      debugLog(`First 100 chars: "${text.substring(0, 100)}"`);
      
      if (text.length === 0) {
        debugError(`EMPTY CONTENT detected in: ${newPath}`);
      }
      
      let updated = updateLinksInMarkdown(text, newPath);
      
      if (updated !== text) {
        changed = true;
        debugLog(`Content was modified during link/tag cleaning`);
      }
      
      content = new TextEncoder().encode(updated);
      debugLog(`Re-encoded content size: ${content.length} bytes`);
      
      // Double-check by decoding again to verify content integrity
      let verification = new TextDecoder('utf-8').decode(content);
      debugLog(`Verification - final text length: ${verification.length} characters`);
      debugLog(`Verification - first 100 chars: "${verification.substring(0, 100)}"`);
      
      if (verification.length !== updated.length) {
        debugError(`CONTENT MISMATCH! Original: ${updated.length}, Final: ${verification.length}`);
      }
      
      if (verification.length === 0) {
        debugError(`FINAL CONTENT IS EMPTY for: ${newPath}`);
      }
    } else {
      debugLog(`Non-markdown file: ${newPath} (${content.length} bytes)`);
    }
    
    if (oldPath !== newPath) {
      changed = true;
      debugLog(`Path renamed: ${oldPath} -> ${newPath}`);
    }
    
    if (changed) {
      changedFiles.add(newPath);
      debugLog(`File marked as changed`);
    }
    
    // Check if this path already exists in newZip
    if (newZip.files[newPath]) {
      debugError(`OVERWRITING existing file in zip: ${newPath}`);
    }
    
    newZip.file(newPath, content);
    debugLog(`Added to new zip: ${newPath}`);
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
    debugError(err);
  });
} 