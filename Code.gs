var REPO = 'woodenExpresso/zmk-config';

function doPost(e) {
  try {
    var data   = JSON.parse(e.postData.contents);
    var action = data.action;
    var result;

    if      (action === 'build')       result = handleBuild(data.keys);
    else if (action === 'status')      result = handleStatus(data.runId);
    else if (action === 'download')    result = handleDownload(data.runId);
    else if (action === 'saveLayout')  result = handleSaveLayout(data);
    else if (action === 'loadLayout')  result = handleGetLayout(data);
    else if (action === 'get_stats')   result = handleGetStats();
    else if (action === 'get_presets') result = handleGetPresets();
    else if (action === 'vote_preset') result = handleVotePreset(data);
    else                               result = { error: 'Unknown action' };

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function handleBuild(keys) {
  var keymap = generateKeymap(keys);
  pushFile('config/macro_hub.keymap', keymap);

  Utilities.sleep(6000);

  var runId = getLatestRunId();
  return { runId: runId };
}

function handleStatus(runId) {
  var token    = getToken();
  var url      = 'https://api.github.com/repos/' + REPO + '/actions/runs/' + runId;
  var response = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true
  });
  var run = JSON.parse(response.getContentText());

  if (run.status === 'completed') {
    return { status: run.conclusion === 'success' ? 'completed' : 'failed', conclusion: run.conclusion };
  }
  return { status: run.status };
}

function handleDownload(runId) {
  var token   = getToken();
  var artUrl  = 'https://api.github.com/repos/' + REPO + '/actions/runs/' + runId + '/artifacts';
  var artResp = UrlFetchApp.fetch(artUrl, { headers: { 'Authorization': 'Bearer ' + token } });
  var artifacts = JSON.parse(artResp.getContentText()).artifacts;
  var artifact  = null;

  for (var i = 0; i < artifacts.length; i++) {
    if (artifacts[i].name === 'firmware') { artifact = artifacts[i]; break; }
  }
  if (!artifact) return { error: 'Firmware artifact not found' };

  var redirectResp = UrlFetchApp.fetch(artifact.archive_download_url, {
    headers: { 'Authorization': 'Bearer ' + token },
    followRedirects: false,
    muteHttpExceptions: true
  });
  var headers = redirectResp.getHeaders();
  var s3Url = headers['Location'] || headers['location'];
  if (!s3Url) return { error: 'No redirect from GitHub (HTTP ' + redirectResp.getResponseCode() + ')' };

  var zipResp = UrlFetchApp.fetch(s3Url, { muteHttpExceptions: true });
  if (zipResp.getResponseCode() !== 200) {
    return { error: 'S3 download failed: HTTP ' + zipResp.getResponseCode() };
  }

  var files = Utilities.unzip(zipResp.getBlob());
  for (var f = 0; f < files.length; f++) {
    if (files[f].getName().indexOf('.uf2') !== -1) {
      return { status: 'ok', filename: 'macro_hub.uf2', data: Utilities.base64Encode(files[f].getBytes()) };
    }
  }
  return { error: '.uf2 file not found inside artifact ZIP' };
}

function handleSaveLayout(data) {
  var keys = data.keys;
  if (!keys || !keys.length) return { error: 'no keys provided' };

  // Generate a unique 6-char code (no ambiguous chars like O, 0, I, 1)
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  var sheet = getOrCreateSheet('saved_layouts', ['code', 'timestamp', 'keys_json']);
  sheet.appendRow([code, new Date(), JSON.stringify(keys)]);

  return { code: code };
}

function handleGetLayout(data) {
  var code = (data.code || '').toUpperCase().trim();
  if (!code) return { error: 'missing code' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('saved_layouts');
  if (!sheet) return { error: 'code not found' };

  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toUpperCase() === code) {
      return { keys: JSON.parse(rows[i][2]) };
    }
  }
  return { error: 'code not found' };
}

function pushFile(path, content) {
  var token   = getToken();
  var url     = 'https://api.github.com/repos/' + REPO + '/contents/' + path;
  var headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

  var getResp = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
  var sha     = null;
  if (getResp.getResponseCode() === 200) {
    sha = JSON.parse(getResp.getContentText()).sha;
  }

  var payload = { message: 'Update ' + path, content: Utilities.base64Encode(content) };
  if (sha) payload.sha = sha;

  UrlFetchApp.fetch(url, { method: 'PUT', headers: headers, payload: JSON.stringify(payload) });
}

function getLatestRunId() {
  var token    = getToken();
  var url      = 'https://api.github.com/repos/' + REPO + '/actions/runs?per_page=1';
  var response = UrlFetchApp.fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
  var runs     = JSON.parse(response.getContentText()).workflow_runs;
  if (!runs || runs.length === 0) throw new Error('No workflow runs found');
  return String(runs[0].id);
}

function getToken() {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_TOKEN not set in Script Properties');
  return token;
}

function keyToSlot(ch, addrHex) {
  var offset = parseInt(addrHex, 16) - 0x20;
  if (ch <= 3) return ch * 4 + offset;
  if (ch === 4) return 16 + offset;
  if (ch === 5) return 18 + offset;
  return -1;
}

function generateKeymap(keys) {
  var bindings = [];
  for (var i = 0; i < 20; i++) bindings.push('&none');

  for (var i = 0; i < keys.length; i++) {
    var k    = keys[i];
    var slot = keyToSlot(Number(k.channel), k.address);
    if (slot >= 0 && slot < 20) {
      bindings[slot] = (k.zmk && k.zmk !== 'NONE') ? '&kp ' + k.zmk : '&none';
    }
  }

  return [
    '#include <behaviors.dtsi>',
    '#include <dt-bindings/zmk/keys.h>',
    '',
    '/ {',
    '    keymap {',
    '        compatible = "zmk,keymap";',
    '        default_layer {',
    '            bindings = <',
    '                ' + bindings.join('\n                '),
    '            >;',
    '        };',
    '    };',
    '};',
    ''
  ].join('\n');
}

// ── Sheet helpers ──────────────────────────────────────────────────────────────

function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

function slotHeaders() {
  var h = [];
  for (var i = 0; i < 20; i++) h.push('slot' + i);
  return h;
}

// ── get_stats ──────────────────────────────────────────────────────────────────

function handleGetStats() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('bindings');
  if (!sheet || sheet.getLastRow() < 2) return { total: 0, slots: [] };

  var data = sheet.getDataRange().getValues();
  var total = data.length - 1;
  var slotStats = [];

  for (var s = 0; s < 20; s++) {
    var counts = {};
    for (var r = 1; r < data.length; r++) {
      var key = data[r][2 + s] || '&none';
      counts[key] = (counts[key] || 0) + 1;
    }
    var entries = Object.keys(counts).map(function(k) {
      return { zmk: k, count: counts[k], pct: Math.round(counts[k] * 100 / total) };
    });
    entries.sort(function(a, b) { return b.count - a.count; });
    slotStats.push(entries.slice(0, 5));
  }

  return { total: total, slots: slotStats };
}

// ── get_presets ────────────────────────────────────────────────────────────────

function handleGetPresets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('presets');
  if (!sheet || sheet.getLastRow() < 2) return { presets: [] };

  var data = sheet.getDataRange().getValues();
  var presets = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var keys = [];
    for (var s = 0; s < 20; s++) keys.push({ zmk: row[3 + s] || '&none' });
    presets.push({ id: row[0], name: row[1], app: row[2], keys: keys, votes: row[23] || 0 });
  }
  presets.sort(function(a, b) { return b.votes - a.votes; });
  return { presets: presets };
}

// ── vote_preset ────────────────────────────────────────────────────────────────

function handleVotePreset(data) {
  var id = String(data.id || '');
  if (!id) return { error: 'missing id' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('presets');
  if (!sheet) return { error: 'no presets sheet' };

  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === id) {
      var current = Number(sheet.getRange(i + 1, 24).getValue()) || 0;
      sheet.getRange(i + 1, 24).setValue(current + 1);
      return { status: 'ok', votes: current + 1 };
    }
  }
  return { error: 'preset not found' };
}
