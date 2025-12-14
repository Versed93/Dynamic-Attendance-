
import React, { useState } from 'react';
import { InfoIcon } from './icons/InfoIcon';

const appScriptCode = `
// --- CONFIGURATION ---
// Sheets: "W1-W5" (Cols O-T) -> "W6-W10" (Cols K-T) -> "W11-W14" (Cols K-T)
// Date Header Row: 12
// Student Data: Row 14+ (ID in Col B, Name in Col D)

function getFormattedDate() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy");
}

function getSheetConfigs() {
  return [
    // Order matters: Fills W1-W5 first, then moves to W6-W10, then W11-W14
    { name: "W1-W5", dateRow: 12, startCol: 15, endCol: 20 }, // Cols O to T
    { name: "W6-W10", dateRow: 12, startCol: 11, endCol: 20 }, // Cols K to T
    { name: "W11-W14", dateRow: 12, startCol: 11, endCol: 20 } // Cols K to T
  ];
}

function findTargetContext(doc, dateStr) {
  var configs = getSheetConfigs();
  
  // 1. Search for EXISTING date across all configured sheets
  for (var i = 0; i < configs.length; i++) {
    var conf = configs[i];
    var sheet = doc.getSheetByName(conf.name);
    if (!sheet) continue;
    
    for (var c = conf.startCol; c <= conf.endCol; c++) {
       var cell = sheet.getRange(conf.dateRow, c);
       // Handle Merged Cells (only check top-left)
       if (cell.isPartOfMerge()) {
          var range = cell.getMergedRanges()[0];
          if (range.getColumn() != c || range.getRow() != conf.dateRow) continue;
       }
       
       if (cell.getDisplayValue().trim() == dateStr) {
         return { sheet: sheet, col: c, isNew: false };
       }
    }
  }

  // 2. Search for first EMPTY slot if date not found
  for (var i = 0; i < configs.length; i++) {
    var conf = configs[i];
    var sheet = doc.getSheetByName(conf.name);
    if (!sheet) continue;
    
    for (var c = conf.startCol; c <= conf.endCol; c++) {
       var cell = sheet.getRange(conf.dateRow, c);
       if (cell.isPartOfMerge()) {
          var range = cell.getMergedRanges()[0];
          if (range.getColumn() != c || range.getRow() != conf.dateRow) continue;
       }
       
       if (cell.getDisplayValue().trim() == "") {
         return { sheet: sheet, col: c, isNew: true };
       }
    }
  }
  
  return null;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); 
    
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    
    // Parse Input
    var data = {};
    if (e.parameter && e.parameter.studentId) {
      data = e.parameter;
    } else {
      try {
        if (e.postData) data = JSON.parse(e.postData.contents);
      } catch(err){}
    }
    
    var studentId = data.studentId ? data.studentId.toUpperCase().trim() : "";
    var studentName = data.name ? data.name.toUpperCase().trim() : "";
    var status = data.status || 'P';
    var dateStr = getFormattedDate();

    if (!studentId) {
      return ContentService.createTextOutput(JSON.stringify({"result":"error", "message":"Missing Data"})).setMimeType(ContentService.MimeType.JSON);
    }

    // --- FIND SHEET & COLUMN ---
    var context = findTargetContext(doc, dateStr);
    
    if (!context) {
      return ContentService.createTextOutput(JSON.stringify({"result":"error", "message":"All sheets (W1-W5, W6-W10, W11-W14) are full."})).setMimeType(ContentService.MimeType.JSON);
    }
    
    var sheet = context.sheet;
    var targetColAbs = context.col;

    // Initialize Date Header if new
    if (context.isNew) {
      sheet.getRange(12, targetColAbs).setValue(new Date()).setNumberFormat("dd/MM/yyyy");
    }

    // --- FIND STUDENT ROW (B14+) ---
    var startRow = 14;
    var idCol = 2; // Column B
    var nameCol = 4; // Column D
    
    var lastSheetRow = Math.max(sheet.getLastRow(), 250);
    // Optimization: Read ID column in one batch
    var idValues = sheet.getRange(startRow, idCol, lastSheetRow - startRow + 1, 1).getValues();
    
    var studentRowRelative = -1;
    var firstEmptyRowRelative = -1;

    for (var i = 0; i < idValues.length; i++) {
      var val = String(idValues[i][0]).toUpperCase().trim();
      if (val == studentId) {
        studentRowRelative = i;
        break;
      }
      if (val == "" && firstEmptyRowRelative == -1) {
        firstEmptyRowRelative = i;
      }
    }

    // Create New Student if not found
    if (studentRowRelative == -1) {
      if (firstEmptyRowRelative != -1) {
        studentRowRelative = firstEmptyRowRelative;
      } else {
        studentRowRelative = idValues.length; // Append
      }

      var newRowAbs = startRow + studentRowRelative;
      sheet.getRange(newRowAbs, idCol).setValue(studentId);   
      sheet.getRange(newRowAbs, nameCol).setValue(studentName); 
    }

    // --- WRITE STATUS ---
    var targetRowAbs = startRow + studentRowRelative;
    sheet.getRange(targetRowAbs, targetColAbs).setValue(status);
    
    SpreadsheetApp.flush(); 
    return ContentService.createTextOutput(JSON.stringify({"result":"success"})).setMimeType(ContentService.MimeType.JSON);
    
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({"result":"error", "message": e.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  var dateStr = getFormattedDate();
  
  var context = findTargetContext(doc, dateStr);
  
  // If date not found (isNew=true means we found an empty slot but not the date), return empty
  if (!context || context.isNew) {
     return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = context.sheet;
  var dateColAbs = context.col;

  // Read Data
  var startRow = 14;
  var lastRow = Math.max(sheet.getLastRow(), 250); 
  
  // Read B (ID), D (Name)
  var studentBlock = sheet.getRange(startRow, 2, lastRow - startRow + 1, 3).getValues(); // Cols 2,3,4
  
  // Read Status Column
  var statusBlock = sheet.getRange(startRow, dateColAbs, lastRow - startRow + 1, 1).getValues();

  var output = [];
  for (var i = 0; i < studentBlock.length; i++) {
    var id = String(studentBlock[i][0]).trim(); // Col B (index 0)
    var name = studentBlock[i][2]; // Col D (index 2)
    var status = statusBlock[i][0];

    if (id && (status == 'P' || status == 'A')) {
      output.push({
         name: name,
         studentId: id,
         email: id + "@STUDENT.UTS.EDU.MY",
         timestamp: new Date().getTime(), 
         status: status
      });
    }
  }

  return ContentService.createTextOutput(JSON.stringify(output)).setMimeType(ContentService.MimeType.JSON);
}
`;

export const GoogleSheetIntegrationInfo: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(appScriptCode.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full p-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 mb-4">
      <div className="flex items-start gap-3">
        <InfoIcon className="w-5 h-5 flex-shrink-0 mt-1 text-blue-500" />
        <div>
          <h3 className="text-lg font-semibold text-blue-900">Update Cloud Storage Script</h3>
          <p className="mt-1 text-sm">
            This update allows the system to automatically switch to subsequent sheets when the previous ones are full.
          </p>
          <ul className="list-disc list-inside mt-2 text-sm space-y-1">
            <li><strong>Sheets Order:</strong> W1-W5 (Cols O-T) → W6-W10 (Cols K-T) → W11-W14 (Cols K-T).</li>
            <li><strong>Headers:</strong> Row 12 (Date is auto-filled here).</li>
            <li><strong>Student Data:</strong> Rows 14+ (Column B & D).</li>
            <li><strong>Overflow:</strong> Automatically finds the first empty column across all configured sheets.</li>
          </ul>
          <div className="mt-4 bg-gray-800 text-white p-3 rounded-md relative">
             <div className="flex justify-between items-center mb-2">
                <h4 className="font-semibold text-gray-300">Script Code:</h4>
                <button 
                     onClick={handleCopy}
                     className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-white transition-colors border border-gray-600"
                     title="Copy to clipboard"
                >
                    {copied ? 'Copied!' : 'Copy Code'}
                </button>
             </div>
            <pre className="text-xs whitespace-pre-wrap break-all p-2 bg-gray-900 rounded border border-gray-700 max-h-60 overflow-y-auto">
              <code>{appScriptCode.trim()}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
