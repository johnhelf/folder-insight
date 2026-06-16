const fs = require('fs');
const path = require('path');
const localesDir = path.join(__dirname, 'src', 'locales');

function getKeysAndValues(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const regex = /^\s+([a-zA-Z0-9_]+|'[^']+')\s*:\s*(['"].*?['"]|`.*?`),?/gm;
    const kv = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        let key = match[1];
        if (key.startsWith("'") && key.endsWith("'")) {
            key = key.slice(1, -1);
        }
        kv.push({ key, value: match[2] });
    }
    return kv;
}

const enFilePath = path.join(localesDir, 'en.ts');
const enKV = getKeysAndValues(enFilePath);

const files = fs.readdirSync(localesDir).filter(f => f.endsWith('.ts') && f !== 'en.ts');

for (const file of files) {
    const filePath = path.join(localesDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    const localeKV = getKeysAndValues(filePath);
    const localeKeys = localeKV.map(x => x.key);
    
    const missing = enKV.filter(x => !localeKeys.includes(x.key));
    if (missing.length > 0) {
        const insertText = missing.map(x => '  ' + (x.key.includes('-') ? `'${x.key}'` : x.key) + ': ' + x.value + ',').join('\n');
        
        // Find the last '}'
        const lastBraceIndex = content.lastIndexOf('}');
        if (lastBraceIndex !== -1) {
            let beforeBrace = content.substring(0, lastBraceIndex);
            // Replace the last non-whitespace character with itself + comma if it's not a comma
            beforeBrace = beforeBrace.replace(/([^,\s])(\s*)$/, '$1,$2');
            content = beforeBrace + insertText + '\n' + content.substring(lastBraceIndex);
            fs.writeFileSync(filePath, content);
            console.log(`Updated ${file} with ${missing.length} missing keys.`);
        }
    }
}
