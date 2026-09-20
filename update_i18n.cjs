const fs = require('fs');
let code = fs.readFileSync('src/i18n.ts', 'utf8');

const translations = {
  zh: { 
    time24h: '24小时内',
    time7d: '7天内',
    time30d: '30天内',
    time1y: '1年内',
    timeOlder: '1年以上',
    allDisks: '所有磁盘',
    physicalDiskPrefix: '物理磁盘 {disk}',
    fileType: '文件类型',
    fileAge: '文件年龄',
  },
  en: { 
    time24h: 'Within 24 Hours',
    time7d: 'Within 7 Days',
    time30d: 'Within 30 Days',
    time1y: 'Within 1 Year',
    timeOlder: 'Older than 1 Year',
    allDisks: 'All Disks',
    physicalDiskPrefix: 'Physical Disk {disk}',
    fileType: 'File Type',
    fileAge: 'File Age',
  },
  ja: { 
    time24h: '24時間以内',
    time7d: '7日以内',
    time30d: '30日以内',
    time1y: '1年以内',
    timeOlder: '1年以上',
    allDisks: 'すべてのディスク',
    physicalDiskPrefix: '物理ディスク {disk}',
    fileType: 'ファイルの種類',
    fileAge: 'ファイルの年齢',
  },
  ko: { 
    time24h: '24시간 이내',
    time7d: '7일 이내',
    time30d: '30일 이내',
    time1y: '1년 이내',
    timeOlder: '1년 이상',
    allDisks: '모든 디스크',
    physicalDiskPrefix: '물리적 디스크 {disk}',
    fileType: '파일 유형',
    fileAge: '파일 나이',
  },
  es: { 
    time24h: 'En 24 horas',
    time7d: 'En 7 días',
    time30d: 'En 30 días',
    time1y: 'En 1 año',
    timeOlder: 'Más de 1 año',
    allDisks: 'Todos los discos',
    physicalDiskPrefix: 'Disco físico {disk}',
    fileType: 'Tipo de archivo',
    fileAge: 'Edad del archivo',
  },
  fr: { 
    time24h: 'Moins de 24h',
    time7d: 'Moins de 7 jours',
    time30d: 'Moins de 30 jours',
    time1y: 'Moins de 1 an',
    timeOlder: 'Plus de 1 an',
    allDisks: 'Tous les disques',
    physicalDiskPrefix: 'Disque physique {disk}',
    fileType: 'Type de fichier',
    fileAge: 'Âge du fichier',
  },
  de: { 
    time24h: 'Innerhalb 24 Std.',
    time7d: 'Innerhalb 7 Tagen',
    time30d: 'Innerhalb 30 Tagen',
    time1y: 'Innerhalb 1 Jahr',
    timeOlder: 'Älter als 1 Jahr',
    allDisks: 'Alle Festplatten',
    physicalDiskPrefix: 'Physischer Datenträger {disk}',
    fileType: 'Dateityp',
    fileAge: 'Dateialter',
  },
  zh_tw: { 
    time24h: '24小時內',
    time7d: '7天內',
    time30d: '30天內',
    time1y: '1年內',
    timeOlder: '1年以上',
    allDisks: '所有磁碟',
    physicalDiskPrefix: '物理磁碟 {disk}',
    fileType: '檔案類型',
    fileAge: '檔案年齡',
  },
  ru: { 
    time24h: 'За 24 часа',
    time7d: 'За 7 дней',
    time30d: 'За 30 дней',
    time1y: 'За 1 год',
    timeOlder: 'Более 1 года',
    allDisks: 'Все диски',
    physicalDiskPrefix: 'Физический диск {disk}',
    fileType: 'Тип файла',
    fileAge: 'Возраст файла',
  },
  ar: { 
    time24h: 'خلال 24 ساعة',
    time7d: 'خلال 7 أيام',
    time30d: 'خلال 30 يومًا',
    time1y: 'خلال سنة واحدة',
    timeOlder: 'أكثر من سنة',
    allDisks: 'كل الأقراص',
    physicalDiskPrefix: 'قرص فعلي {disk}',
    fileType: 'نوع الملف',
    fileAge: 'عمر الملف',
  },
  it: { 
    time24h: 'Nelle ultime 24 ore',
    time7d: 'Negli ultimi 7 giorni',
    time30d: 'Negli ultimi 30 giorni',
    time1y: 'Nell\'ultimo anno',
    timeOlder: 'Più di un anno',
    allDisks: 'Tutti i dischi',
    physicalDiskPrefix: 'Disco fisico {disk}',
    fileType: 'Tipo di file',
    fileAge: 'Età del file',
  }
};

for (const lang of Object.keys(translations)) {
  const trans = translations[lang];
  
  // Check if keys already exist to avoid duplication
  if (code.indexOf(`allDisks: '${trans.allDisks}'`) === -1) {
    // Try to insert after timeOlder
    const anchor = 'timeOlder:.*?,';
    const regex = new RegExp(`(\\b${lang}:\\s*\\{[\\s\\S]*?${anchor})`, 'g');
    
    let replaced = false;
    code = code.replace(regex, (match) => {
        if (replaced) return match;
        replaced = true;
        return `${match}\n      allDisks: '${trans.allDisks}',\n      physicalDiskPrefix: '${trans.physicalDiskPrefix}',`;
    });
    
    if (!replaced) {
        // Fallback
        const fallbackAnchor = 'scanOptions:';
        const fallbackRegex = new RegExp(`(\\b${lang}:\\s*\\{[\\s\\S]*?)(\\s+${fallbackAnchor})`, 'g');
        code = code.replace(fallbackRegex, (match, prefix, suffix) => {
             if (replaced) return match;
             replaced = true;
             return `${prefix}\n      allDisks: '${trans.allDisks}',\n      physicalDiskPrefix: '${trans.physicalDiskPrefix}',${suffix}`;
        });
    }
  }
}

fs.writeFileSync('src/i18n.ts', code);
console.log("Done");
