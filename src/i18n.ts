export type Locale = 'zh' | 'en' | 'ja' | 'ko' | 'es' | 'fr' | 'de';
export type LanguageMode = 'auto' | Locale;

const STORAGE_KEY = 'languageMode';

const normalizeLocale = (lang: string | null | undefined): Locale => {
  const value = (lang ?? '').toLowerCase();
  if (value.startsWith('zh')) return 'zh';
  if (value.startsWith('ja')) return 'ja';
  if (value.startsWith('ko')) return 'ko';
  if (value.startsWith('es')) return 'es';
  if (value.startsWith('fr')) return 'fr';
  if (value.startsWith('de')) return 'de';
  return 'en';
};

export const detectSystemLocale = (): Locale => normalizeLocale(navigator.language);

export const resolveLocale = (mode: LanguageMode, systemLocale: Locale): Locale =>
  mode === 'auto' ? systemLocale : mode;

export const getInitialLanguageMode = (): LanguageMode => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (
      stored === 'auto' ||
      stored === 'zh' ||
      stored === 'en' ||
      stored === 'ja' ||
      stored === 'ko' ||
      stored === 'es' ||
      stored === 'fr' ||
      stored === 'de'
    ) {
      return stored;
    }
  } catch {
    return 'auto';
  }
  return 'auto';
};

export const persistLanguageMode = (mode: LanguageMode) => {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    return;
  }
};

export const getLocaleNativeName = (locale: Locale) => {
  switch (locale) {
    case 'zh':
      return '中文';
    case 'en':
      return 'English';
    case 'ja':
      return '日本語';
    case 'ko':
      return '한국어';
    case 'es':
      return 'Español';
    case 'fr':
      return 'Français';
    case 'de':
      return 'Deutsch';
  }
};

const MESSAGES: Record<Locale, Record<string, string>> = {
  zh: {
    appTitle: '文件夹洞察',
    treeView: '树状图',
    chartView: '统计图',
    selectFolder: '选择文件夹',
    totalSize: '总大小',
    totalFiles: '文件总数',
    rootDirectory: '根目录',
    name: '名称',
    fileCount: '文件数',
    size: '大小',
    itemsCount: '{count} 项',
    calculating: '计算中...',
    calculatingInline: ' (计算中...)',
    analyzing: '正在分析文件夹内容，请稍候...',
    emptyHint: '请选择一个文件夹开始分析',
    openInExplorer: '用文件资源管理器打开',
    topTitle: '占比分析',
    dragHintTitle: '拖拽文件夹到窗口开始分析',
    dragHintSubtitle: 'Drop a folder to start analysis',
    otherItems: '其他 ({count}项)',
    languageAuto: '跟随系统',
    languageTitle: '语言',
  },
  en: {
    appTitle: 'Folder Insight',
    treeView: 'Tree',
    chartView: 'Chart',
    selectFolder: 'Select Folder',
    totalSize: 'Total Size',
    totalFiles: 'Total Files',
    rootDirectory: 'Root Directory',
    name: 'Name',
    fileCount: 'Files',
    size: 'Size',
    itemsCount: '{count} items',
    calculating: 'Calculating...',
    calculatingInline: ' (Calculating...)',
    analyzing: 'Analyzing folder contents, please wait...',
    emptyHint: 'Select a folder to start analysis',
    openInExplorer: 'Open in File Explorer',
    topTitle: 'Breakdown',
    dragHintTitle: 'Drop a folder to start analysis',
    dragHintSubtitle: 'Drag and drop a folder to start analysis',
    otherItems: 'Other ({count})',
    languageAuto: 'Auto',
    languageTitle: 'Language',
  },
  ja: {
    appTitle: 'Folder Insight',
    treeView: 'ツリー',
    chartView: 'チャート',
    selectFolder: 'フォルダーを選択',
    totalSize: '合計サイズ',
    totalFiles: 'ファイル数',
    rootDirectory: 'ルート',
    name: '名前',
    fileCount: '件数',
    size: 'サイズ',
    itemsCount: '{count} 件',
    calculating: '計算中...',
    calculatingInline: '（計算中...）',
    analyzing: 'フォルダーを分析しています。しばらくお待ちください...',
    emptyHint: 'フォルダーを選択して分析を開始します',
    openInExplorer: 'エクスプローラーで開く',
    topTitle: '内訳',
    dragHintTitle: 'フォルダーをドロップして分析開始',
    dragHintSubtitle: 'Drop a folder to start analysis',
    otherItems: 'その他（{count}）',
    languageAuto: '自動',
    languageTitle: '言語',
  },
  ko: {
    appTitle: 'Folder Insight',
    treeView: '트리',
    chartView: '차트',
    selectFolder: '폴더 선택',
    totalSize: '전체 크기',
    totalFiles: '파일 수',
    rootDirectory: '루트',
    name: '이름',
    fileCount: '파일',
    size: '크기',
    itemsCount: '{count}개',
    calculating: '계산 중...',
    calculatingInline: ' (계산 중...)',
    analyzing: '폴더를 분석하는 중입니다. 잠시만 기다려 주세요...',
    emptyHint: '폴더를 선택하여 분석을 시작하세요',
    openInExplorer: '파일 탐색기에서 열기',
    topTitle: '분포',
    dragHintTitle: '폴더를 드롭하여 분석 시작',
    dragHintSubtitle: 'Drop a folder to start analysis',
    otherItems: '기타 ({count})',
    languageAuto: '자동',
    languageTitle: '언어',
  },
  es: {
    appTitle: 'Folder Insight',
    treeView: 'Árbol',
    chartView: 'Gráfico',
    selectFolder: 'Seleccionar carpeta',
    totalSize: 'Tamaño total',
    totalFiles: 'Total de archivos',
    rootDirectory: 'Directorio raíz',
    name: 'Nombre',
    fileCount: 'Archivos',
    size: 'Tamaño',
    itemsCount: '{count} elementos',
    calculating: 'Calculando...',
    calculatingInline: ' (Calculando...)',
    analyzing: 'Analizando el contenido de la carpeta, espera...',
    emptyHint: 'Selecciona una carpeta para empezar',
    openInExplorer: 'Abrir en el explorador',
    topTitle: 'Desglose',
    dragHintTitle: 'Suelta una carpeta para analizar',
    dragHintSubtitle: 'Drop a folder to start analysis',
    otherItems: 'Otros ({count})',
    languageAuto: 'Auto',
    languageTitle: 'Idioma',
  },
  fr: {
    appTitle: 'Folder Insight',
    treeView: 'Arborescence',
    chartView: 'Graphique',
    selectFolder: 'Choisir un dossier',
    totalSize: 'Taille totale',
    totalFiles: 'Total des fichiers',
    rootDirectory: 'Dossier racine',
    name: 'Nom',
    fileCount: 'Fichiers',
    size: 'Taille',
    itemsCount: '{count} éléments',
    calculating: 'Calcul en cours...',
    calculatingInline: ' (Calcul en cours...)',
    analyzing: 'Analyse du dossier, veuillez patienter...',
    emptyHint: 'Choisissez un dossier pour commencer',
    openInExplorer: "Ouvrir dans l'explorateur",
    topTitle: 'Répartition',
    dragHintTitle: 'Déposez un dossier pour analyser',
    dragHintSubtitle: 'Drop a folder to start analysis',
    otherItems: 'Autres ({count})',
    languageAuto: 'Auto',
    languageTitle: 'Langue',
  },
  de: {
    appTitle: 'Folder Insight',
    treeView: 'Baum',
    chartView: 'Diagramm',
    selectFolder: 'Ordner auswählen',
    totalSize: 'Gesamtgröße',
    totalFiles: 'Dateien gesamt',
    rootDirectory: 'Stammordner',
    name: 'Name',
    fileCount: 'Dateien',
    size: 'Größe',
    itemsCount: '{count} Elemente',
    calculating: 'Wird berechnet...',
    calculatingInline: ' (Wird berechnet...)',
    analyzing: 'Ordner wird analysiert, bitte warten...',
    emptyHint: 'Wähle einen Ordner, um zu starten',
    openInExplorer: 'Im Explorer öffnen',
    topTitle: 'Aufschlüsselung',
    dragHintTitle: 'Ordner ablegen, um zu starten',
    dragHintSubtitle: 'Drop a folder to start analysis',
    otherItems: 'Andere ({count})',
    languageAuto: 'Auto',
    languageTitle: 'Sprache',
  },
};

export const createTranslator =
  (locale: Locale) =>
  (key: string, params?: Record<string, string | number>) => {
    const template = MESSAGES[locale][key] ?? MESSAGES.en[key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''));
  };
