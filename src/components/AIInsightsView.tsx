import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { Loader2, Settings, Sparkles, AlertCircle, File as FileIcon, Folder as FolderIcon, ExternalLink, Download } from 'lucide-react';
import { formatSize } from '../utils';
import { DiskStats } from '../types';

interface LargeFileInfo {
  path: string;
  size: number;
  is_dir: boolean;
  extension?: string;
  last_accessed?: number;
  last_modified?: number;
  children_summary?: string[];
}

interface AIReportResult {
  path: string;
  reason: string;
  action: string;
}

interface AIInsightsViewProps {
  rootPaths: string[];
  t: (key: string, params?: Record<string, string | number>) => string;
  onOpenExplorer: (path: string) => void;
  locale: string;
}

export const AIInsightsView: React.FC<AIInsightsViewProps> = ({ rootPaths, onOpenExplorer, t, locale }) => {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('ai_api_key') || '');
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem('ai_api_url') || 'https://api.openai.com/v1/chat/completions');
  const [model, setModel] = useState(() => localStorage.getItem('ai_model') || 'gpt-4o-mini');
  const [aiThreshold, setAiThreshold] = useState(() => parseInt(localStorage.getItem('ai_threshold') || '500', 10));
  const [showSettings, setShowSettings] = useState(false);
  const [hasAcceptedDisclaimer, setHasAcceptedDisclaimer] = useState(() => localStorage.getItem('ai_disclaimer_accepted') === 'true');
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  
  const [isScanning, setIsScanning] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [largeFiles, setLargeFiles] = useState<LargeFileInfo[]>([]);
  const [insights, setInsights] = useState<AIReportResult[]>([]);
  
  // Confirmation state
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [rawPrompt, setRawPrompt] = useState('');
  const [estimatedTokens, setEstimatedTokens] = useState(0);

  const [rawResponse, setRawResponse] = useState('');
  const [showRawData, setShowRawData] = useState(false);
  const [scannedCount, setScannedCount] = useState(0);

  useEffect(() => {
    const unlistenProgress = listen('ai-scan-progress', (event) => {
      const payload = event.payload as { scanned: number; currentPath: string };
      setScannedCount(payload.scanned);
    });

    return () => {
      unlistenProgress.then(f => f());
    };
  }, []);

  useEffect(() => {
    if (showConfirmation) {
      setShowSettings(false);
    }
  }, [showConfirmation]);

  useEffect(() => {
    if (showConfirmation && largeFiles.length > 0) {
      invoke<string>('preview_ai_prompt', {
        files: largeFiles,
        language: locale
      }).then(promptPreview => {
        setRawPrompt(promptPreview);
        setEstimatedTokens(Math.ceil(promptPreview.length / 4));
      }).catch(err => {
        console.error('Failed to update prompt preview on locale change', err);
      });
    }
  }, [locale, showConfirmation, largeFiles]);

  useEffect(() => {
    localStorage.setItem('ai_api_key', apiKey);
    localStorage.setItem('ai_api_url', apiUrl);
    localStorage.setItem('ai_model', model);
    localStorage.setItem('ai_threshold', aiThreshold.toString());
  }, [apiKey, apiUrl, model, aiThreshold]);

  const handleStartAnalysis = async () => {
    if (!hasAcceptedDisclaimer) {
      setShowDisclaimer(true);
      return;
    }

    if (!apiKey) {
      setError('Please configure your API Key first.');
      setShowSettings(true);
      return;
    }
    
    setError(null);
    
    // If we already have large files, just show the confirmation again unless it's a new request
    if (largeFiles.length > 0 && !isScanning && !isAnalyzing && !showConfirmation) {
      setShowConfirmation(true);
      setShowSettings(false);
      return;
    }

    setIsScanning(true);
    setScannedCount(0);
    setShowSettings(false); // Close settings when starting analysis
    setInsights([]);
    setLargeFiles([]);
    
    try {
      let scanPaths = rootPaths;
      
      // If no paths provided (e.g. ALL_DISKS mode), fetch all disk roots
      if (scanPaths.length === 0) {
          const stats = await invoke<DiskStats[]>("get_all_disk_stats");
          scanPaths = stats.map(d => d.mount_point);
      }

      // 1. Scan for large files and folders
      const minSize = aiThreshold * 1024 * 1024;
      const items: LargeFileInfo[] = await invoke('get_large_items_report', {
        rootPaths: scanPaths,
        minSize
      });
      
      setLargeFiles(items);
      setIsScanning(false);
      
      if (items.length === 0) {
        setError(t('noLargeItemsFound'));
        return;
      }
      
      const promptPreview = await invoke<string>('preview_ai_prompt', {
        files: items,
        language: locale
      });
      
      setRawPrompt(promptPreview);
      // Roughly estimate tokens (1 token ~= 4 chars)
      setEstimatedTokens(Math.ceil(promptPreview.length / 4));
      setShowConfirmation(true);
      
    } catch (err: any) {
      console.error('AI Analysis error:', err);
      setError(err.toString());
      setIsScanning(false);
    }
  };

  const handleCancelScan = async () => {
    try {
      await invoke('cancel_ai_scan');
    } catch (e) {
      console.error('Failed to cancel AI scan', e);
    }
  };

  const handleConfirmAnalysis = async () => {
    setIsAnalyzing(true);
    setShowConfirmation(false); // Move this here to transition immediately
    
    try {
      const response: { results: AIReportResult[], raw_response: string } = await invoke('get_ai_insights', {
        apiKey,
        apiUrl,
        model,
        files: largeFiles,
        language: locale
      });
      
      if (!response.results || response.results.length === 0) {
        throw new Error('AI returned an empty response or invalid format.');
      }
      
      setInsights(response.results);
      setRawResponse(response.raw_response);
    } catch (err: any) {
      console.error('AI Analysis error:', err);
      setError(typeof err === 'string' ? err : err.message || JSON.stringify(err));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getActionColor = (action: string) => {
    const act = action.toLowerCase();
    if (act.includes('delete') || act.includes('remove')) return 'text-red-600 bg-red-50/50 border-red-200/50 dark:text-red-400 dark:bg-red-900/10 dark:border-red-800/50';
    if (act.includes('compress') || act.includes('zip')) return 'text-orange-600 bg-orange-50/50 border-orange-200/50 dark:text-orange-400 dark:bg-orange-900/10 dark:border-orange-800/50';
    if (act.includes('archive') || act.includes('move')) return 'text-blue-600 bg-blue-50/50 border-blue-200/50 dark:text-blue-400 dark:bg-blue-900/10 dark:border-blue-800/50';
    return 'text-green-600 bg-green-50/50 border-green-200/50 dark:text-green-400 dark:bg-green-900/10 dark:border-green-800/50';
  };

  const getTranslatedAction = (action: string) => {
    const act = action.toLowerCase();
    if (act.includes('delete') || act.includes('remove')) return t('actionDelete');
    if (act.includes('compress') || act.includes('zip')) return t('actionCompress');
    if (act.includes('archive') || act.includes('move')) return t('actionArchive');
    if (act.includes('keep') || act.includes('ignore')) return t('actionKeep');
    return action;
  };

  const handleAcceptDisclaimer = () => {
    localStorage.setItem('ai_disclaimer_accepted', 'true');
    setHasAcceptedDisclaimer(true);
    setShowDisclaimer(false);
    // Proceed with analysis check after accepting
    if (!apiKey) {
      setError('Please configure your API Key first.');
      setShowSettings(true);
    } else {
      handleStartAnalysis();
    }
  };

  const handleExport = async () => {
    if (insights.length === 0) return;
    
    try {
      const filePath = await save({
        filters: [{
          name: 'HTML Document',
          extensions: ['html']
        }],
        defaultPath: 'ai-insights-report.html'
      });

      if (!filePath) return; // User cancelled

      const title = t('aiInsightsTitle');
      const reasonText = t('reason');
      
      const htmlContent = `<!DOCTYPE html>
<html lang="${locale}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #333; max-width: 1000px; margin: 0 auto; padding: 2rem; background: #f9fafb; }
        h1 { color: #4f46e5; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
        .card { background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #e5e7eb; }
        .path { font-family: monospace; font-size: 0.9em; color: #4b5563; word-break: break-all; margin: 0.5rem 0; padding: 0.5rem; background: #f3f4f6; border-radius: 4px; }
        .action-badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.75rem; font-weight: bold; text-transform: uppercase; border: 1px solid currentColor; }
        .reason { margin-top: 1rem; padding-left: 1rem; border-left: 4px solid #c7d2fe; color: #4b5563; }
        .footer { margin-top: 2rem; font-size: 0.8em; color: #6b7280; text-align: center; }
    </style>
</head>
<body>
    <h1>${title}</h1>
    <div class="disclaimer" style="padding: 1rem; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; margin-bottom: 2rem; color: #b45309;">
        <strong>⚠️ ${t('aiResultDisclaimer')}</strong>
    </div>
    ${insights.map(i => {
      const translatedAction = getTranslatedAction(i.action);
      return `
    <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;">
            <div style="flex: 1;">
                <div class="path">${i.path}</div>
                <div class="reason">
                    <strong>${reasonText}:</strong><br/>
                    ${i.reason}
                </div>
            </div>
            <div class="action-badge">${translatedAction}</div>
        </div>
    </div>`;
    }).join('')}
    <div class="footer">Generated by Folder Insight AI</div>
</body>
</html>`;

      await writeTextFile(filePath, htmlContent);
    } catch (err) {
      console.error('Failed to export:', err);
      setError('Export failed: ' + err);
    }
  };

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">
      {/* Disclaimer Modal */}
      {showDisclaimer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-amber-500 mb-4">
              <AlertCircle size={24} />
              <h2 className="text-lg font-bold">{t('aiDisclaimerTitle')}</h2>
            </div>
            <div className="space-y-4 text-sm text-gray-600 dark:text-gray-300">
              <p>{t('aiDisclaimerP1')}</p>
              <p>{t('aiDisclaimerP2')}</p>
              <p className="font-medium text-gray-900 dark:text-gray-100">{t('aiDisclaimerP3')}</p>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowDisclaimer(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleAcceptDisclaimer}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors"
              >
                {t('accept')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Raw Data Modal */}
      {showRawData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-4xl w-full p-6 animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="flex items-center gap-3 text-blue-500 mb-4 shrink-0">
              <FileIcon size={24} />
              <h2 className="text-lg font-bold">{t('aiRawData')}</h2>
            </div>
            <div className="flex-1 flex flex-col gap-4 overflow-hidden min-h-0">
              <div className="flex-1 flex flex-col min-h-0">
                <h3 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300 shrink-0">{t('aiPrompt')}</h3>
                <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700 custom-scrollbar">
                  <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">
                    {rawPrompt}
                  </pre>
                </div>
              </div>
              <div className="flex-1 flex flex-col min-h-0">
                <h3 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300 shrink-0">{t('aiResponse')}</h3>
                <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700 custom-scrollbar">
                  <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">
                    {rawResponse}
                  </pre>
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3 shrink-0">
              <button
                onClick={() => setShowRawData(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6 shrink-0">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2 text-gray-800 dark:text-gray-100">
            <Sparkles className="text-indigo-500" />
            {t('aiInsightsTitle')}
          </h2>
          <p className="text-sm text-gray-500 mt-1">{t('aiInsightsSubtitle')}</p>
        </div>
        <div className="flex gap-3">
          {insights.length > 0 && (
            <>
              <button
                onClick={() => setShowRawData(true)}
                className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                title={t('viewRawData')}
              >
                <FileIcon size={16} />
                <span className="hidden sm:inline">{t('rawData')}</span>
              </button>
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
                title={t('exportResults')}
              >
                <Download size={16} />
                <span className="hidden sm:inline">{t('export')}</span>
              </button>
            </>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
            title={t('configAI')}
          >
            <Settings size={20} />
          </button>
          <button
            onClick={handleStartAnalysis}
            disabled={isScanning || isAnalyzing}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {isScanning || isAnalyzing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Sparkles size={16} />
            )}
            {isScanning ? t('scanning') : isAnalyzing ? t('analyzing') : t('startAnalysis')}
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 shrink-0">
          <h3 className="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">{t('configAI')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('apiUrl')}</label>
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="https://api.openai.com/v1/chat/completions"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('model')}</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="gpt-4o-mini"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('apiKey')}</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="sk-..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('aiAnalysisThreshold')} (MB)</label>
              <input
                type="number"
                min="100"
                value={aiThreshold}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) setAiThreshold(Math.max(100, val));
                }}
                className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3 shrink-0">
          <AlertCircle className="text-red-500 mt-0.5 shrink-0" size={18} />
          <p className="text-sm text-red-700 dark:text-red-400 break-all">{error}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
        {(isScanning || isAnalyzing) && (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 text-center px-4">
            <Loader2 size={48} className="animate-spin text-indigo-500 mb-4" />
            <h3 className="text-lg font-medium text-gray-700 dark:text-gray-200 mb-2">
              {isScanning ? t('searchingDisk') : t('aiAnalyzing')}
            </h3>
            <p className="text-sm mb-6">
              {isScanning 
                ? `${t('scannedFilesCount', { count: scannedCount })}` 
                : t('analysisTimeHint')}
            </p>
            {isScanning && (
              <div className="flex flex-col items-center w-full max-w-xs">
                <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mt-4 mb-6">
                  <div className="h-full bg-indigo-500 animate-[progress_10s_ease-in-out_infinite]"></div>
                </div>
                <button
                  onClick={handleCancelScan}
                  className="px-6 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-lg transition-colors border border-red-200/50 dark:border-red-800/50"
                >
                  {t('cancelScan')}
                </button>
              </div>
            )}
            {isAnalyzing && (
              <div className="w-64 max-w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mt-4">
                <div className="h-full bg-indigo-500 animate-[progress_20s_ease-in-out_forwards]" style={{ width: '90%' }}></div>
              </div>
            )}
          </div>
        )}

        {!isScanning && !isAnalyzing && showConfirmation && (
          <div className="h-full flex flex-col animate-in slide-in-from-top-4 duration-300">
            <div className="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-indigo-500/30 p-6 flex flex-col shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3 text-indigo-500">
                  <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg">
                    <Sparkles size={20} />
                  </div>
                  <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('confirmAIAnalysis')}</h2>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowConfirmation(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    onClick={handleConfirmAnalysis}
                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
                  >
                    {t('confirmAndSend')}
                  </button>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="p-4 bg-blue-50/50 dark:bg-blue-900/10 rounded-xl border border-blue-100/50 dark:border-blue-800/50">
                  <p className="text-[10px] text-blue-600/70 dark:text-blue-400/70 font-bold uppercase tracking-widest mb-1">{t('largeFilesTotalSize')}</p>
                  <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{formatSize(largeFiles.reduce((acc, f) => acc + f.size, 0))}</p>
                </div>
                <div className="p-4 bg-indigo-50/50 dark:bg-indigo-900/10 rounded-xl border border-indigo-100/50 dark:border-indigo-800/50">
                  <p className="text-[10px] text-indigo-600/70 dark:text-indigo-400/70 font-bold uppercase tracking-widest mb-1">{t('aiTokenEstimate')}</p>
                  <p className="text-xl font-bold text-indigo-700 dark:text-indigo-300">~{estimatedTokens} <span className="text-xs font-normal opacity-60 ml-1">tokens</span></p>
                </div>
              </div>

              <div className="flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">{t('aiDataPreview')}</p>
                </div>
                <div className="flex-1 min-h-[200px] max-h-[400px] overflow-y-auto bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4 border border-gray-200 dark:border-gray-800 custom-scrollbar">
                  <pre className="text-xs text-gray-700 dark:text-gray-400 whitespace-pre-wrap font-mono leading-relaxed">
                    {rawPrompt}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {!isScanning && !isAnalyzing && !showConfirmation && largeFiles.length === 0 && !error && insights.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 py-12">
            <div className="relative mb-6">
              <Sparkles size={64} className="opacity-10" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles size={32} className="opacity-20 animate-pulse text-indigo-500" />
              </div>
            </div>
            <p className="text-lg font-medium text-gray-400/80">{t('clickToAnalyze')}</p>
          </div>
        )}

        {insights.length > 0 && (
          <div className="space-y-4 pb-4">
            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl flex items-start gap-3">
              <AlertCircle className="text-amber-500 mt-0.5 shrink-0" size={18} />
              <p className="text-sm text-amber-700 dark:text-amber-400 font-medium">
                {t('aiResultDisclaimer')}
              </p>
            </div>
            {insights.map((insight, idx) => {
              const fileInfo = largeFiles.find(f => f.path === insight.path);
              return (
                <div key={idx} className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {fileInfo?.is_dir ? (
                          <FolderIcon size={16} className="text-blue-400 shrink-0" />
                        ) : (
                          <FileIcon size={16} className="text-gray-400 shrink-0" />
                        )}
                        <h4 className="font-medium text-gray-800 dark:text-gray-200 truncate" title={insight.path}>
                          {insight.path.split(/[/\\]/).pop()}
                        </h4>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate mb-3" title={insight.path}>
                        {insight.path}
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {fileInfo && (
                          <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded-md text-gray-600 dark:text-gray-300">
                            {formatSize(fileInfo.size)}
                          </span>
                        )}
                      </div>
                      {insight.reason && (
                        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400 leading-relaxed border-l-2 border-indigo-500/30 pl-3 py-1 bg-indigo-50/30 dark:bg-indigo-900/10 rounded-r-lg">
                          {insight.reason}
                        </p>
                      )}
                    </div>
                    
                    <div className="flex flex-row sm:flex-col items-center sm:items-end gap-3 shrink-0">
                      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border transition-all ${getActionColor(insight.action)}`}>
                        <div className="w-1.5 h-1.5 rounded-full bg-current opacity-70"></div>
                        {getTranslatedAction(insight.action)}
                      </div>
                      <button
                        onClick={() => onOpenExplorer(insight.path)}
                        className="p-1.5 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-all"
                        title={t('openLocation')}
                      >
                        <ExternalLink size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
