const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, 'src', 'locales');

// Parse a simple JS/TS object from file content
function extractKeys(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const keys = [];
    
    // This is a naive regex-based approach for simple key-value pairs
    // It looks for patterns like: key: 'value', or 'key': 'value',
    const regex = /^\s*([a-zA-Z0-9_]+|'[^']+')\s*:/gm;
    let match;
    while ((match = regex.exec(content)) !== null) {
        let key = match[1];
        if (key.startsWith("'") && key.endsWith("'")) {
            key = key.slice(1, -1);
        }
        keys.push(key);
    }
    return keys;
}

function checkTranslations() {
    const enFilePath = path.join(localesDir, 'en.ts');
    
    if (!fs.existsSync(enFilePath)) {
        console.error('Base locale file (en.ts) not found!');
        return;
    }

    const baseKeys = extractKeys(enFilePath);
    console.log(`Found ${baseKeys.length} keys in base locale (en.ts)`);

    const files = fs.readdirSync(localesDir).filter(f => f.endsWith('.ts') && f !== 'en.ts');
    
    let hasMissing = false;

    for (const file of files) {
        const filePath = path.join(localesDir, file);
        const localeKeys = extractKeys(filePath);
        
        const missingKeys = baseKeys.filter(key => !localeKeys.includes(key));
        
        if (missingKeys.length > 0) {
            hasMissing = true;
            console.log(`\n❌ [${file}] is missing ${missingKeys.length} translations:`);
            missingKeys.forEach(k => console.log(`   - ${k}`));
        } else {
            console.log(`✅ [${file}] is up to date.`);
        }
    }

    if (hasMissing) {
        console.log('\nPlease update the missing translations in the respective locale files.');
    } else {
        console.log('\nAll locale files are fully translated!');
    }
}

checkTranslations();