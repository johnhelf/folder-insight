//! AI 洞察相关命令：提示词预览、AI 分析请求与 AI 扫描取消。

use tauri::State;

use crate::models::{AIReportResult, LargeFileInfo};
use crate::state::AppState;

/// 拼接 AI 提示词，要求模型返回 JSON 数组（path/reason/action）
fn build_ai_prompt(files: &Vec<LargeFileInfo>, language: &str) -> String {
    let mut prompt = format!("Please analyze the following large files and provide recommendations.
IMPORTANT REQUIREMENTS:
1. You MUST respond in this language: {}.
2. For each file, provide a 'reason' for your suggestion and an 'action' (e.g., 'Delete', 'Compress', 'Archive', 'Keep'). Keep it concise.
3. If your recommendation involves using specialized Windows tools, you MUST include a brief usage tutorial or an official documentation link in the 'reason' field. For example:
   - Component store; use DISM to clean safely (https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/clean-up-the-winsxs-folder)
   - Old driver packages can be removed using pnputil (https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/pnputil)
   - Orphaned installer file; verify with PatchCleaner (https://patchcleaner.codeplex.com/)

Files to analyze:\n\n", language);
    for file in files {
        let type_str = if file.is_dir { "Folder" } else { "File" };
        prompt.push_str(&format!("Type: {}, Path: {}, Size: {} bytes, Ext: {}, Last Modified: {} unix timestamp\n",
            type_str, file.path, file.size, file.extension, file.last_modified));
    }

    prompt.push_str("\nRespond ONLY with a JSON array of objects, where each object has 'path', 'reason', and 'action' fields. Ensure valid JSON.");

    prompt
}

#[tauri::command]
pub async fn preview_ai_prompt(files: Vec<LargeFileInfo>, language: String) -> Result<String, String> {
    Ok(build_ai_prompt(&files, &language))
}

#[derive(serde::Serialize)]
pub struct AIInsightResponse {
    pub results: Vec<AIReportResult>,
    pub raw_response: String,
}

#[tauri::command]
pub async fn get_ai_insights(
    api_key: String,
    api_url: String,
    model: String,
    files: Vec<LargeFileInfo>,
    language: String,
) -> Result<AIInsightResponse, String> {
    if files.is_empty() {
        return Ok(AIInsightResponse {
            results: Vec::new(),
            raw_response: String::new(),
        });
    }

    let mut final_api_url = api_url.trim().to_string();
    if final_api_url.ends_with('/') {
        final_api_url.pop();
    }
    if !final_api_url.ends_with("/chat/completions") && !final_api_url.contains("/v1/messages") && !final_api_url.contains("/api/generate") {
        if final_api_url.ends_with("/v1") {
            final_api_url.push_str("/chat/completions");
        } else {
            final_api_url.push_str("/v1/chat/completions");
        }
    }

    let client = reqwest::Client::new();
    let prompt = build_ai_prompt(&files, &language);

    let request_body = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "You are a helpful assistant that analyzes large files and folders and suggests actions to free up disk space."
            },
            {
                "role": "user",
                "content": prompt
            }
        ]
    });

    let response = client.post(&final_api_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = response.status();
    let response_text = response.text().await.map_err(|e| format!("Failed to read response body: {}", e))?;

    if !status.is_success() {
        return Err(format!("AI API returned error status {}: {}", status, response_text));
    }

    if response_text.trim().is_empty() {
        return Err("AI API returned an empty response body".to_string());
    }

    let response_json: serde_json::Value = serde_json::from_str(&response_text).map_err(|e| format!("Failed to parse response JSON: {}, response text: {}", e, response_text))?;

    let content = response_json["choices"][0]["message"]["content"].as_str().ok_or("Failed to extract content from AI response")?;

    let content_clean = content.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();

    if content_clean.is_empty() {
        return Err("AI response content is empty after cleaning".to_string());
    }

    let results: Vec<AIReportResult> = serde_json::from_str(content_clean).map_err(|e| format!("Failed to parse AI response content JSON: {}, content: {}", e, content_clean))?;

    Ok(AIInsightResponse {
        results,
        raw_response: response_text,
    })
}

#[tauri::command]
pub async fn cancel_ai_scan(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(token) = state.ai_scan_cancel_token.lock().unwrap().as_ref() {
        token.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}