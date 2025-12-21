
import React, { useState } from 'react';
import { InfoIcon } from './icons/InfoIcon';

const appScriptCode = `
/**
 * HIGH-CONCURRENCY ATTENDANCE SCRIPT (v3.1)
 * Optimized for 200-300 simultaneous requests.
 */

function getFormattedDate() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy");
}

function getSheetConfigs() {
  return [
    { name: "W1-W5", dateRow: 12, startCol: 15, endCol: 20 },
    { name: "W6-W10", dateRow: 12, startCol: 11, endCol: 20 },
    { name: "W11-W14", dateRow: 12, startCol: 11, endCol: 20 }
  ];
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // Increase wait time for the lock to 30s to handle 200+ users
    lock.waitLock(30000); 
    
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var data = {};
    try {
      if (e.postData) data = JSON.parse(e.postData.contents);
    } catch(err) {
      data = e.parameter || {};
    }
    
    var studentId = String(data.studentId || "").toUpperCase().trim();
    var studentName = String(data.name || "").toUpperCase().trim();
    var status = data.status || 'P';
    var dateStr = getFormattedDate();

    if (!studentId) throw "Missing Student ID";

    var configs = getSheetConfigs();
    var targetSheet, targetCol, isNewDate = true;

    // 1. Find sheet and column (Cached approach)
    for (var i = 0; i < configs.length; i++) {
      var conf = configs[i];
      var sheet = doc.getSheetByName(conf.name);
      if (!sheet) continue;
      
      var headerValues = sheet.getRange(conf.dateRow, conf.startCol, 1, conf.endCol - conf.startCol + 1).getDisplayValues()[0];
      
      // Look for current date
      for (var c = 0; c < headerValues.length; c++) {
        if (headerValues[c].trim() === dateStr) {
          targetSheet = sheet;
          targetCol = conf.startCol + c;
          isNewDate = false;
          break;
        }
      }
      if (targetSheet) break;

      // Look for first available empty column
      for (var c = 0; c < headerValues.length; c++) {
        if (headerValues[c].trim() === "") {
          targetSheet = sheet;
          targetCol = conf.startCol + c;
          break;
        }
      }
      if (targetSheet) break;
    }

    if (!targetSheet) throw "All attendance sheets (W1-W14) are full.";

    if (isNewDate) {
      targetSheet.getRange(12, targetCol).setValue(new Date()).setNumberFormat("dd/MM/yyyy");
    }

    // 2. Find or Add Student Row (Fast lookup)
    var startRow = 14;
    var lastRow = Math.max(targetSheet.getLastRow(), 250);
    var ids = targetSheet.getRange(startRow, 2, lastRow - startRow + 1, 1).getValues();
    
    var studentRowAbs = -1;
    for (var r = 0; r < ids.length; r++) {
      var idInCell = String(ids[r][0]).toUpperCase().trim();
      if (idInCell === studentId) {
        studentRowAbs = startRow + r;
        break;
      }
      if (studentRowAbs === -1 && idInCell === "") {
        studentRowAbs = startRow + r;
        // Batch write student info to reduce API calls
        targetSheet.getRange(studentRowAbs, 2, 1, 3).setValues([[studentId, "", studentName]]);
        break;
      }
    }

    // If still not found and sheet was full of other data
    if (studentRowAbs === -1) {
       studentRowAbs = lastRow + 1;
       targetSheet.getRange(studentRowAbs, 2).setValue(studentId);
       targetSheet.getRange(studentRowAbs, 4).setValue(studentName);
    }

    // 3. Mark the Attendance Status
    targetSheet.getRange(studentRowAbs, targetCol).setValue(status);
    
    // Explicitly flush to ensure data is written before lock release
    SpreadsheetApp.flush();
    
    return ContentService.createTextOutput(JSON.stringify({result: "success"})).setMimeType(ContentService.MimeType.JSON);
    
  } catch (err) {
    console.error("Attendance Error: " + err);
    return ContentService.createTextOutput(JSON.stringify({result: "error", message: err.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  try {
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var dateStr = getFormattedDate();
    var configs = getSheetConfigs();
    
    for (var i = 0; i < configs.length; i++) {
      var conf = configs[i];
      var sheet = doc.getSheetByName(conf.name);
      if (!sheet) continue;
      
      var headerValues = sheet.getRange(conf.dateRow, conf.startCol, 1, conf.endCol - conf.startCol + 1).getDisplayValues()[0];
      var colIdx = -1;
      for (var c = 0; c < headerValues.length; c++) {
        if (headerValues[c].trim() === dateStr) { colIdx = conf.startCol + c; break; }
      }
      
      if (colIdx !== -1) {
        var lastRow = Math.max(sheet.getLastRow(), 250);
        var data = sheet.getRange(14, 2, lastRow - 14 + 1, 3).getValues(); // Cols B-D
        var statuses = sheet.getRange(14, colIdx, lastRow - 14 + 1, 1).getValues();
        
        var results = [];
        for (var j = 0; j < data.length; j++) {
          var id = String(data[j][0]).trim();
          var stat = statuses[j][0];
          if (id && (stat === 'P' || stat === 'A')) {
            results.push({ studentId: id, name: data[j][2], status: stat });
          }
        }
        return ContentService.createTextOutput(JSON.stringify(results)).setMimeType(ContentService.MimeType.JSON);
      }
    }
    return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);
  } catch(e) {
    return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);
  }
}
`;

export const GoogleSheetIntegrationInfo: React.FC = () => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="w-full p-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 mb-4 shadow-sm">
      <div className="flex items-start gap-3">
        <InfoIcon className="w-6 h-6 mt-1 text-blue-600" />
        <div>
          <h3 className="text-lg font-bold text-blue-900">High-Traffic Fix (V3.1)</h3>
          <p className="mt-1 text-sm text-blue-800 leading-relaxed">
            Google has a limit of ~30 simultaneous connections. For 230 students, you <strong>MUST</strong> use this script. 
            It increases the "waiting time" so that students' requests line up instead of failing.
          </p>
          <div className="mt-4 bg-gray-900 p-4 rounded-xl border border-blue-200">
            <div className="flex justify-between items-center mb-3">
              <span className="text-[10px] text-blue-400 font-mono tracking-widest uppercase">CONCURRENCY OPTIMIZED</span>
              <button 
                onClick={() => { navigator.clipboard.writeText(appScriptCode.trim()); setCopied(true); setTimeout(()=>setCopied(false),2000); }} 
                className={`text-xs px-4 py-1.5 rounded-full font-bold transition-all ${copied ? 'bg-green-600 text-white' : 'bg-brand-primary text-white hover:bg-brand-secondary'}`}
              >
                {copied ? '✓ COPIED' : 'COPY OPTIMIZED SCRIPT'}
              </button>
            </div>
            <pre className="text-[9px] text-gray-400 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono p-2 bg-black/30 rounded">
              {appScriptCode.trim()}
            </pre>
          </div>
          <p className="mt-3 text-[11px] text-blue-600 italic">
            * After copying, go to Apps Script, paste, Save, and click "Deploy > New Deployment" (Version: Anyone).
          </p>
        </div>
      </div>
    </div>
  );
};
