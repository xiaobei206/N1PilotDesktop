(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const params = { maxBytes: 2 * 1024 * 1024 };
  let initialized = null;
  let cm = null;
  let snapshot = null;
  let baselineText = '';
  let baselineHash = '';
  let baselineEncoding = 'utf8';
  let baselineBom = false;
  let baselineEols = [];
  let currentLanguage = 'zh';
  let currentSyntax = 'text';
  let dirty = false;
  let isApplyingProgrammaticChange = false;
  let validationTimer = null;
  let draftTimer = null;
  let validationSequence = 0;
  let diagnostics = [];
  let whitespaceMarks = [];
  let whitespaceViewportKey = '';
  let whitespaceRefreshTimer = null;
  let suggestionText = null;
  let pendingClose = false;
  let savePromise = null;
  let saveSequence = 0;
  let remoteConflict = null;
  let debugEnabled = true;
  let selectedRecoveryDrafts = [];
  let searchMarks = [];
  let searchMatchPositions = [];
  let searchCurrentIndex = -1;

  const STR = {
    zh: {
      saved:'已保存', modified:'已修改', reading:'正在读取远程文件…', ready:'就绪', loadFailed:'读取失败',
      editor:'远程文件编辑器', loading:'正在读取远程文件', doNotClose:'请勿关闭窗口',
      save:'保存', saving:'正在保存…', saveOk:'保存成功', saveFailed:'保存失败',
      find:'查找', replace:'替换', wrap:'自动换行', wrapOn:'自动换行：开', wrapOff:'自动换行：关', findLabel:'查找', replaceLabel:'替换为', previous:'上一个', next:'下一个', replaceOne:'替换', replaceAll:'全部替换', close:'关闭', matchCase:'区分大小写', matches:(n,i)=>n?`${i+1}/${n} 个匹配`:'无匹配', check:'检查', remoteCheck:'远端 sh -n', copyDiagnosis:'复制问题描述',
      showInvisible:'不可见字符', debug:'DEBUG', log:'日志', encoding:'编码', eol:'换行',
      checking:'正在检查…', checkClean:'未发现明确语法错误', checkIssues:n=>`发现 ${n} 项问题`,
      diagnostics:'问题检查', waiting:'等待检查', clear:'清空列表', collapse:'收起', expand:'展开',
      noIssues:'目前没有发现问题。检查不会修改代码。',
      issueError:'错误', issueWarning:'可疑', issueInfo:'提示',
      lineCol:(l,c)=>`行 ${l}，列 ${c}`, language:'语言',
      utf8:'UTF-8', utf8bom:'UTF-8 BOM', utf16le:'UTF-16 LE', utf16lebom:'UTF-16 LE BOM', utf16be:'UTF-16 BE', utf16bebom:'UTF-16 BE BOM', windows1252:'Windows-1252', latin1:'ISO-8859-1',
      preserve:'保留原样', LF:'LF', CRLF:'CRLF', CR:'CR', mixed:'混合换行',
      markdownDetected:'检测到可能的格式问题', markdownDescription:'从 AI 对话复制来的文本可能包含代码围栏或隐藏字符。原文尚未修改。',
      previewFence:'预览建议修正', keep:'保持原样', apply:'应用修改（可撤销）',
      noCleanSuggestion:'没有足够确定的安全自动建议。请检查下列问题，原文保持不变。',
      diff:'修改预览', before:'修改前', after:'建议内容',
      sourceText:'当前编辑内容', remoteText:'服务器当前版本',
      conflictTitle:'远程文件已发生变化', conflictDesc:'读取文件后，服务器上的文件内容发生了变化。为避免覆盖别人的修改，保存已暂停。请对比两个版本，再决定是否覆盖。',
      conflictWarning:'覆盖将以你当前编辑的内容替换服务器现有内容。再次检查远程文件版本后才会执行，不会自动合并。',
      overwrite:'仍然覆盖远程文件', cancelSave:'取消保存',
      closeTitle:'文件尚未保存', closeDesc:'此文件有未保存的修改。你可以保存后关闭、放弃修改，或返回继续编辑。',
      closeCancel:'继续编辑', closeDiscard:'放弃修改并关闭', closeSave:'保存并关闭', saveInProgressDiscardConfirm:'远程保存仍在进行中。关闭窗口无法保证服务器写入会被取消，服务器文件可能仍然发生变化。仍要关闭并放弃本地草稿吗？',
      recoveryTitle:'发现未保存的恢复草稿', recoveryDesc:'以下草稿来自之前未正常关闭的编辑器。选择后会载入草稿，但不会自动保存到服务器。',
      recoveryIgnore:'忽略恢复草稿', recoveryUse:'恢复此草稿', draftAt:'草稿时间',
      restored:'已恢复草稿；请检查内容后再保存。',
      remoteChangedDraft:'警告：服务器文件可能已在草稿创建后变化，保存时会再次检测冲突。',
      shellCheckStart:'正在通过远程 sh -n 检查语法（不会执行脚本）…', shellCheckOk:'远端 sh -n 检查通过；这不代表命令执行一定成功。', shellCheckFail:'远端 sh -n 发现语法错误。脚本没有执行。',
      shellCheckUnavailable:'无法运行远端语法检查；原文未改变。',
      diagnosisCopied:'问题描述已复制。没有包含整份文件内容。',
      diagHidden:'检测到可疑的 Unicode 隐藏字符', diagFence:'检测到 Markdown 代码围栏，可能不是目标文件的一部分',
      diagProse:'文件中可能混入了代码以外的说明文字（仅提示，不自动判错）',
      diagLine:'行', col:'列', noSource:'没有可复制的问题描述。', sizeLimit:'文件超过 2 MiB 的文本编辑限制，为避免误读或误保存未打开。',
      binary:'该文件疑似二进制内容，未作为文本打开。', unsupported:'无法安全识别文件编码。文件没有修改。',
      encodingLoss:'所选编码无法表示部分字符。为防止字符被替换，请改用 UTF-8 或其他合适编码后保存。',
      yes:'是', no:'否', noShell:'远端没有可用的 sh -n 检查器，或检查通道失败。',
      logOpenFail:'无法打开 DEBUG 日志目录', debugOn:'DEBUG 已开启', debugOff:'DEBUG 已关闭',
      formatChanged:'格式设置已修改', current:'当前', remote:'远程', fileSize:'文件大小',
      conflictCopy:'复制冲突描述', skipRecovery:'忽略此草稿', restore:'恢复',
      remoteDisconnected:'SSH 会话已断开。未保存内容仍保留在本地草稿中。',
      shellStructure:'Shell 结构提示（启发式）', shellQuote:'疑似未闭合的引号', shellBrace:'疑似未闭合的花括号', shellBraceClose:'存在没有对应开括号的花括号',
      hiddenNbsp:'不换行空格', hiddenZero:'零宽空格', hiddenBom:'正文中包含 BOM 字符', hiddenControl:'非标准控制字符', smartQuoteWarning:'弯引号可能与代码所需的 ASCII 引号不同', fullWidthWarning:'检测到全角标点，确认该语言是否接受',
      formatWarning:'格式提醒', changedRemote:'远程文件发生变化', saveNoTarget:'没有可保存的文件',
    },
    en: {
      saved:'Saved', modified:'Modified', reading:'Reading remote file…', ready:'Ready', loadFailed:'Read failed',
      editor:'Remote File Editor', loading:'Reading remote file', doNotClose:'Please do not close this window',
      save:'Save', saving:'Saving…', saveOk:'Saved successfully', saveFailed:'Save failed',
      find:'Find', replace:'Replace', wrap:'Word wrap', wrapOn:'Word wrap: On', wrapOff:'Word wrap: Off', findLabel:'Find', replaceLabel:'Replace with', previous:'Previous', next:'Next', replaceOne:'Replace', replaceAll:'Replace all', close:'Close', matchCase:'Match case', matches:(n,i)=>n?`${i+1}/${n} matches`:'No matches', check:'Check', remoteCheck:'Remote sh -n', copyDiagnosis:'Copy issue prompt',
      showInvisible:'Invisible characters', debug:'DEBUG', log:'Logs', encoding:'Encoding', eol:'Line endings',
      checking:'Checking…', checkClean:'No definite syntax errors found', checkIssues:n=>`${n} issue(s) found`,
      diagnostics:'Diagnostics', waiting:'Waiting for checks', clear:'Clear list', collapse:'Collapse', expand:'Expand',
      noIssues:'No issues found so far. Checks never modify the code.',
      issueError:'Error', issueWarning:'Review', issueInfo:'Info',
      lineCol:(l,c)=>`Ln ${l}, Col ${c}`, language:'Language',
      utf8:'UTF-8', utf8bom:'UTF-8 BOM', utf16le:'UTF-16 LE', utf16lebom:'UTF-16 LE BOM', utf16be:'UTF-16 BE', utf16bebom:'UTF-16 BE BOM', windows1252:'Windows-1252', latin1:'ISO-8859-1',
      preserve:'Preserve original', LF:'LF', CRLF:'CRLF', CR:'CR', mixed:'Mixed line endings',
      markdownDetected:'Potential formatting issues detected', markdownDescription:'Text copied from an AI chat may contain code fences or hidden characters. The original text has not been changed.',
      previewFence:'Preview suggested cleanup', keep:'Keep as-is', apply:'Apply change (undoable)',
      noCleanSuggestion:'There is no sufficiently certain safe suggestion. Review the issues below; the original text is unchanged.',
      diff:'Change preview', before:'Before', after:'Suggested text',
      sourceText:'Your edited version', remoteText:'Current server version',
      conflictTitle:'Remote file changed', conflictDesc:'The server-side file changed after it was loaded. Saving is paused to avoid overwriting someone else’s changes. Compare the versions before deciding.',
      conflictWarning:'Overwrite replaces the current server file with your edited text. The remote version is checked again before replacing; no automatic merge is attempted.',
      overwrite:'Overwrite remote file anyway', cancelSave:'Cancel save',
      closeTitle:'Unsaved changes', closeDesc:'This file has unsaved changes. Save before closing, discard changes, or continue editing.',
      closeCancel:'Keep editing', closeDiscard:'Discard and close', closeSave:'Save and close', saveInProgressDiscardConfirm:'A remote save is still in progress. Closing cannot guarantee the server write will be cancelled, and the remote file may still change. Close and discard the local draft anyway?',
      recoveryTitle:'Unsaved recovery drafts found', recoveryDesc:'These drafts are from editors that did not close normally. Restoring a draft loads it locally; it is not saved to the server automatically.',
      recoveryIgnore:'Ignore recovery drafts', recoveryUse:'Restore this draft', draftAt:'Draft time',
      restored:'Draft restored. Review it before saving.',
      remoteChangedDraft:'Warning: the server file may have changed since this draft was created. Save will check for conflicts.',
      shellCheckStart:'Checking syntax with remote sh -n (script will not be executed)…', shellCheckOk:'Remote sh -n passed; this does not guarantee commands will succeed.', shellCheckFail:'Remote sh -n found a syntax error. The script was not executed.',
      shellCheckUnavailable:'Could not run the remote syntax check; source text was not changed.',
      diagnosisCopied:'Issue prompt copied. The complete file content was not included.',
      diagHidden:'Suspicious Unicode invisible character found', diagFence:'Markdown code fences found; they may not belong in the target file',
      diagProse:'Possible prose mixed into code (informational only; not automatically treated as an error)',
      diagLine:'Line', col:'Col', noSource:'No issue description to copy.', sizeLimit:'The file exceeds the 2 MiB text-editor limit. It was not opened to avoid misreading or saving it incorrectly.',
      binary:'This appears to be a binary file and was not opened as text.', unsupported:'Encoding could not be identified safely. The file was not modified.',
      encodingLoss:'The selected encoding cannot represent some characters. Switch to UTF-8 or another suitable encoding to avoid character replacement.',
      yes:'Yes', no:'No', noShell:'Remote sh -n is unavailable or the check channel failed.',
      logOpenFail:'Could not open the DEBUG log folder', debugOn:'DEBUG enabled', debugOff:'DEBUG disabled',
      formatChanged:'Format settings changed', current:'Current', remote:'Remote', fileSize:'File size',
      conflictCopy:'Copy conflict prompt', skipRecovery:'Ignore this draft', restore:'Restore',
      remoteDisconnected:'SSH session disconnected. Unsaved text remains in the local draft.',
      shellStructure:'Shell structure hint (heuristic)', shellQuote:'Possibly unclosed quote', shellBrace:'Possibly unclosed curly brace', shellBraceClose:'Closing curly brace has no matching opener',
      hiddenNbsp:'Non-breaking space', hiddenZero:'Zero-width space', hiddenBom:'BOM character inside text', hiddenControl:'Nonstandard control character', smartQuoteWarning:'Curly quotes may differ from required ASCII quotes', fullWidthWarning:'Full-width punctuation may not be valid in this language',
      formatWarning:'Format warning', changedRemote:'Remote file changed', saveNoTarget:'No file to save',
    }
  };
  const t = (key, ...args) => { const v = STR[currentLanguage][key] ?? STR.zh[key] ?? key; return typeof v === 'function' ? v(...args) : v; };
  function setTxt(id, value) { const node = $(id); if (node) node.textContent = value; }
  function edDebug(action, details = {}) {
    if (!debugEnabled) return;
    try { window.remoteEditor.debugLog ? window.remoteEditor.debugLog({ action:`editor.${action}`, details }) : null; } catch {}
    // editor-preload deliberately exposes no generic IPC send; use the main app debug API where enabled.
    try { if (window.remoteEditor.debugLog) return; } catch {}
  }
  function setRemoteStatus(message, state='') {
    const node = $('remote-status'); node.className = `status-chip ${state}`;
    node.replaceChildren(); const dot = document.createElement('i'); dot.className='dot'; const span=document.createElement('span'); span.textContent=message; node.append(dot,span);
  }
  function bytesText(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024*1024) return `${(n/1024).toFixed(1)} KiB`;
    return `${(n/1024/1024).toFixed(2)} MiB`;
  }
  function modeForPath(filePath) {
    const fullPath = String(filePath || '').replace(/\\/g, '/').toLowerCase();
    const name = fullPath.split('/').pop();
    const ext = name.includes('.') ? name.split('.').pop() : '';
    // OpenWrt UCI configuration files such as /etc/config/network have no extension.
    if (fullPath.includes('/etc/config/')) return 'properties';
    if (['sh','bash','ash','zsh','profile','bashrc','bash_profile','zshrc'].includes(ext) || ['makefile','dockerfile'].includes(name)) return ext === 'dockerfile' || name === 'dockerfile' ? 'dockerfile' : 'shell';
    if (['json','jsonc'].includes(ext)) return 'json';
    if (['yaml','yml'].includes(ext)) return 'yaml';
    if (['ini','properties','conf','cfg','config','conf.d'].includes(ext)) return 'properties';
    if (['toml'].includes(ext)) return 'toml';
    if (['lua'].includes(ext)) return 'lua';
    if (['py'].includes(ext)) return 'python';
    if (['js','mjs','cjs'].includes(ext)) return 'javascript';
    if (['xml','html','htm','svg'].includes(ext)) return 'xml';
    if (['css'].includes(ext)) return 'css';
    if (['sql'].includes(ext)) return 'sql';
    if (['diff','patch'].includes(ext)) return 'diff';
    return 'text';
  }
  function monacoLanguageId(kind) {
    const language = {
      shell:'shell', json:'json', yaml:'yaml', properties:'ini', toml:'ini', lua:'lua',
      python:'python', javascript:'javascript', xml:'xml', css:'css', sql:'sql', diff:'diff',
      dockerfile:'dockerfile', text:'plaintext'
    };
    return language[kind] || 'plaintext';
  }
  function formatLabel(encoding, bom) {
    if (encoding === 'utf8' && bom) return 'UTF-8 BOM';
    if (encoding === 'utf16le' && bom) return 'UTF-16 LE BOM';
    if (encoding === 'utf16be' && bom) return 'UTF-16 BE BOM';
    const key = encoding === 'utf8' ? 'utf8' : encoding === 'utf16le' ? 'utf16le' : encoding === 'utf16be' ? 'utf16be' : encoding === 'windows1252' ? 'windows1252' : encoding === 'latin1' ? 'latin1' : 'utf8';
    return t(key);
  }
  function encodingSelectValue(encoding, bom) {
    if (encoding === 'utf8') return bom ? 'utf8bom' : 'utf8';
    if (encoding === 'utf16le') return bom ? 'utf16le-bom' : 'utf16le';
    if (encoding === 'utf16be') return bom ? 'utf16be-bom' : 'utf16be';
    return encoding;
  }
  function parseEncodingSelect(value) {
    if (value === 'utf8bom') return {encoding:'utf8',bom:true};
    if (value === 'utf16le-bom') return {encoding:'utf16le',bom:true};
    if (value === 'utf16be-bom') return {encoding:'utf16be',bom:true};
    if (value === 'utf16le' || value === 'utf16be') return {encoding:value,bom:false};
    if (value === 'windows1252' || value === 'latin1') return {encoding:value,bom:false};
    return {encoding:'utf8',bom:false};
  }
  function selectedFormat() { return parseEncodingSelect($('encoding-select').value); }
  function effectiveEol() { return $('eol-select').value; }
  function displayEol() {
    if (effectiveEol() !== 'preserve') return effectiveEol();
    if (!snapshot) return 'LF';
    return snapshot.eolLabel === 'Mixed' ? t('mixed') : (snapshot.eolLabel || 'LF');
  }
  function formatDirty() {
    const chosen = selectedFormat();
    return chosen.encoding !== baselineEncoding || chosen.bom !== baselineBom || effectiveEol() !== 'preserve';
  }
  function updateDirty() {
    if (!cm || !snapshot) return;
    const nextDirty = cm.getValue() !== baselineText || formatDirty();
    const changed = nextDirty !== dirty;
    dirty = nextDirty;
    updateStateUI();
    if (changed) {
      window.remoteEditor.setDirty(dirty);
      edDebug('dirty-state', {dirty, lineCount:cm.lineCount(), textLength:cm.getValue().length, encoding:selectedFormat().encoding, eol:effectiveEol()});
    }
    if (dirty) scheduleDraftSave();
    else {
      clearTimeout(draftTimer);
      window.remoteEditor.deleteDraft().catch(() => {});
    }
  }
  function updateStateUI() {
    $('dirty-pill').className = `pill ${dirty?'dirty':'clean'}`;
    setTxt('dirty-pill', dirty ? t('modified') : t('saved'));
    $('save-btn').disabled = !cm || !dirty;
    $('undo-btn').disabled = !cm || !cm.historySize().undo;
    $('redo-btn').disabled = !cm || !cm.historySize().redo;
    if (cm) {
      const cur = cm.getCursor(); setTxt('cursor-status', t('lineCol',cur.line+1,cur.ch+1));
      setTxt('size-status', bytesText(new TextEncoder().encode(cm.getValue()).length));
    }
    setTxt('encoding-status', formatLabel(selectedFormat().encoding,selectedFormat().bom));
    setTxt('eol-status', effectiveEol() === 'preserve' ? (snapshot?.eolLabel === 'Mixed' ? t('mixed') : (snapshot?.eolLabel || 'LF')) : effectiveEol());
    if (dirty) setTxt('save-status', t('modified')); else setTxt('save-status', t('ready'));
  }
  async function persistCurrentDraft() {
    if (!dirty || !cm || !snapshot) return { ok: true, skipped: true };
    const fmt = selectedFormat();
    const result = await window.remoteEditor.saveDraft({
      content:cm.getValue(), originalText:baselineText, originalEols:baselineEols, baseHash:baselineHash,
      encoding:fmt.encoding,bom:fmt.bom,eolChoice:effectiveEol(), originalEncoding:baselineEncoding, originalBom:baselineBom,
      cursor:cm.getCursor(),scrollInfo:cm.getScrollInfo(),lineCount:cm.lineCount()
    });
    edDebug('draft.saved',{ok:!!result?.ok,bytes:result?.bytes||0,dirty:true});
    return result;
  }
  function scheduleDraftSave() {
    clearTimeout(draftTimer);
    if (!dirty || !cm || !snapshot) return;
    draftTimer = setTimeout(async () => {
      try { await persistCurrentDraft(); }
      catch (error) { edDebug('draft.save-error',{error:String(error?.message||error)}); }
    }, 900);
  }
  function runShellHeuristics(text) {
    const issues = [];
    let quote = null, quoteLine = 1, quoteCol = 1, escaped = false, line=1, col=0, inComment=false;
    const braces=[];
    for (let i=0;i<text.length;i++) {
      const ch=text[i]; col++;
      if (ch === '\n') { line++; col=0; inComment=false; escaped=false; continue; }
      if (inComment) continue;
      if (escaped) { escaped=false; continue; }
      if (ch === '\\' && quote !== "'") { escaped=true; continue; }
      if (quote) { if (ch===quote) quote=null; continue; }
      if ((ch==="'" || ch==='"' || ch==='`')) { quote=ch;quoteLine=line;quoteCol=col;continue; }
      if (ch==='#' && (i===0 || /\s/.test(text[i-1]))) { inComment=true; continue; }
      if (ch==='{') braces.push({line,col});
      else if (ch==='}') {
        if (!braces.length) issues.push({severity:'error',line,column:col,message:t('shellBraceClose')});
        else braces.pop();
      }
    }
    if (quote) issues.push({severity:'error',line:quoteLine,column:quoteCol,message:t('shellQuote')});
    for (const b of braces) issues.push({severity:'error',line:b.line,column:b.col,message:t('shellBrace')});
    return issues;
  }
  function scanTextWarnings(text) {
    const issues=[];
    const lines=text.split('\n');
    const patterns=[
      {regex:/\u00a0/g,key:'hiddenNbsp'},
      {regex:/[\u200b\u200c\u200d\u2060]/g,key:'hiddenZero'},
      {regex:/\ufeff/g,key:'hiddenBom'},
      {regex:/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,key:'hiddenControl'},
      {regex:/[“”‘’]/g,key:'smartQuoteWarning'},
      {regex:/[：＝，；（）［］｛｝]/g,key:'fullWidthWarning'}
    ];
    for(let row=0;row<lines.length;row++) for(const p of patterns){p.regex.lastIndex=0;let m;while((m=p.regex.exec(lines[row]))){issues.push({severity:'warning',line:row+1,column:m.index+1,message:`${t(p.key)} (U+${m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4,'0')})`}); if(issues.length>500)return issues;}}
    const fence=detectMarkdownFence(text);
    if(fence) issues.push({severity:'warning',line:fence.start+1,column:1,message:t('diagFence'),kind:'markdown-fence'});
    return issues;
  }
  function detectMarkdownFence(text) {
    const lines=String(text).split('\n');
    const fenceIndexes=[];
    for(let i=0;i<lines.length;i++) if(/^\s*```/.test(lines[i])) fenceIndexes.push(i);
    if(!fenceIndexes.length) return null;
    const first=fenceIndexes[0],last=fenceIndexes[fenceIndexes.length-1];
    const open=/^\s*```(?:[a-zA-Z0-9_+.-]+)?\s*$/.test(lines[first]);
    const close=/^\s*```\s*$/.test(lines[last]);
    const onlyOuterPair=fenceIndexes.length===2&&open&&close&&first<last;
    const noOutsideText=!lines.slice(0,first).some(x=>x.trim())&&!lines.slice(last+1).some(x=>x.trim());
    const canSuggest=onlyOuterPair&&noOutsideText;
    let suggested=null;
    if(canSuggest) suggested=lines.slice(0,first).concat(lines.slice(first+1,last),lines.slice(last+1)).join('\n');
    return {start:first,end:last,suggested,canSuggest};
  }
  function mergeDiagnostics(...groups) {
    const all=groups.flat().filter(Boolean);
    all.sort((a,b)=>(a.line||0)-(b.line||0)||(a.column||0)-(b.column||0)||String(a.message).localeCompare(String(b.message)));
    return all.slice(0,1000);
  }
  function lineClassMarkers(nextDiagnostics) {
    if(!cm) return;
    const old=cm.state._n1LineMarks||[]; old.forEach(m=>m.clear());
    const marks=[];
    for(const item of nextDiagnostics){
      if(!item.line||item.line<1||item.line>cm.lineCount()) continue;
      marks.push(cm.markText({line:item.line-1,ch:0},{line:item.line-1,ch:Math.max(1,cm.getLine(item.line-1).length)},{className:item.severity==='error'?'cm-error-token':'cm-diagnostic-warn-line'}));
    }
    cm.state._n1LineMarks=marks;
  }
  function renderDiagnostics() {
    const root=$('diagnostics-list'); root.replaceChildren();
    setTxt('diagnostics-count', diagnostics.length ? t('checkIssues',diagnostics.length) : t('noIssues'));
    const errorCount=diagnostics.filter(d=>d.severity==='error').length;
    $('validation-status').className=`status-chip ${errorCount?'error':diagnostics.length?'warn':'ok'}`;
    setTxt('validation-status',diagnostics.length?t('checkIssues',diagnostics.length):t('checkClean'));
    if(!diagnostics.length){
      const empty=document.createElement('div');empty.className='diagnostic-empty';empty.textContent=t('noIssues');root.append(empty);
      lineClassMarkers([]);
      try { const model=cm?.getEditor()?.getModel(); if(model && window.monaco?.editor) window.monaco.editor.setModelMarkers(model,'n1pilot-diagnostics',[]); } catch(error) { edDebug('monaco.markers-clear-error',{error:String(error?.message||error)}); }
      return;
    }
    for(const item of diagnostics){
      const row=document.createElement('button');row.type='button';row.className='diagnostic-row';
      const sev=document.createElement('span');sev.className=`diag-severity ${item.severity==='warning'?'warning':''}`;sev.textContent=t(item.severity==='error'?'issueError':item.severity==='warning'?'issueWarning':'issueInfo');
      const loc=document.createElement('span');loc.className='diag-location';loc.textContent=item.line?`${item.line}:${item.column||1}`:'—';
      const msg=document.createElement('span');msg.className='diag-message';msg.textContent=item.message||'';
      row.append(sev,loc,msg);row.addEventListener('click',()=>{if(item.line&&cm){cm.focus();cm.setCursor({line:Math.max(0,item.line-1),ch:Math.max(0,(item.column||1)-1)});cm.scrollIntoView({line:item.line-1,ch:0},100);}});root.append(row);
    }
    lineClassMarkers(diagnostics);
    try {
      const model = cm?.getEditor()?.getModel();
      if (model && window.monaco?.editor) window.monaco.editor.setModelMarkers(model, 'n1pilot-diagnostics', diagnostics.filter(d => d.line && d.column).map(d => {
        const line = Math.max(1, Math.min(model.getLineCount(), Math.trunc(d.line)));
        const startColumn = Math.max(1, Math.min(model.getLineMaxColumn(line), Math.trunc(d.column)));
        const endColumn = Math.min(model.getLineMaxColumn(line), startColumn + 1);
        return { startLineNumber: line, startColumn, endLineNumber: line, endColumn,
          message: String(d.message || ''), severity: d.severity === 'error' ? window.monaco.MarkerSeverity.Error : d.severity === 'warning' ? window.monaco.MarkerSeverity.Warning : window.monaco.MarkerSeverity.Info,
          source: String(d.source || 'N1PilotDesktop') };
      }));
    } catch (error) { edDebug('monaco.markers-error', { error:String(error?.message || error) }); }
  }
  async function validateContent({showPasteDialog=false}={}) {
    if(!cm) return;
    const seq=++validationSequence; const text=cm.getValue();
    setTxt('validation-status',t('checking'));
    try {
      let parsed=[];
      if(currentSyntax==='json'||currentSyntax==='yaml') {
        const result=await window.remoteEditor.validate(text,currentSyntax);
        if(seq!==validationSequence) return;
        parsed=result?.diagnostics||[];
      }
      const warnings=scanTextWarnings(text);
      const heuristic=currentSyntax==='shell'?runShellHeuristics(text):[];
      diagnostics=mergeDiagnostics(parsed,heuristic,warnings);
      renderDiagnostics();
      edDebug('validation.complete',{syntax:currentSyntax,issueCount:diagnostics.length,errorCount:diagnostics.filter(x=>x.severity==='error').length,warningCount:diagnostics.filter(x=>x.severity==='warning').length,lines:cm.lineCount()});
      if(showPasteDialog){
        const fence=detectMarkdownFence(text); const hidden=warnings.filter(x=>/U\+[0-9A-F]{4}/.test(x.message));
        const suspiciousPunctuation=warnings.filter(x=>/smartQuoteWarning|fullWidthWarning/.test(x.message));
        if(fence||hidden.length||suspiciousPunctuation.length) showSuggestionDialog({fence,hidden:[...hidden,...suspiciousPunctuation]});
      }
    } catch(error){edDebug('validation.error',{syntax:currentSyntax,error:String(error?.message||error)});}
  }
  function scheduleValidation(options={}) { clearTimeout(validationTimer); validationTimer=setTimeout(()=>validateContent(options),250); }
  function buildSuggestedCleanup(text, fence, hidden) {
    let suggested = String(text);
    if (fence?.canSuggest) suggested = fence.suggested;
    // These are suggestions only. Never apply them automatically; the user must review a diff.
    const hasNbsp = /\u00a0/.test(suggested);
    const hasZeroWidth = /[\u200b\u200c\u200d\u2060]/.test(suggested);
    const hasEmbeddedBom = /\ufeff/.test(suggested);
    if (hasNbsp) suggested = suggested.replace(/\u00a0/g, ' ');
    if (hasZeroWidth) suggested = suggested.replace(/[\u200b\u200c\u200d\u2060]/g, '');
    if (hasEmbeddedBom) suggested = suggested.replace(/\ufeff/g, '');
    return suggested === text ? null : suggested;
  }
  function showSuggestionDialog({fence,hidden}) {
    const list=$('suggestion-issues');list.replaceChildren();
    const entries=[];
    if(fence) entries.push({line:fence.start+1,message:t('diagFence')});
    if(hidden.length) entries.push(...hidden.slice(0,10).map(x=>({line:x.line,message:`${x.message} · ${t('diagLine')} ${x.line}, ${t('col')} ${x.column}`})));
    for(const item of entries){const node=document.createElement('div');node.className='suggestion-issue';node.textContent=`${item.line?`${t('diagLine')} ${item.line}: `:''}${item.message}`;list.append(node);}
    setTxt('suggestion-title',t('markdownDetected'));setTxt('suggestion-description',t('markdownDescription'));
    suggestionText=buildSuggestedCleanup(cm.getValue(),fence,hidden);
    $('suggestion-preview-btn').classList.toggle('hidden',!suggestionText);
    $('suggestion-dialog').showModal();
    edDebug('paste-warning.dialog',{hasMarkdownFence:!!fence,suspiciousUnicodeCount:hidden.length,hasSuggestedCleanup:!!suggestionText});
  }
  function clearSearchMarks() { for (const mark of searchMarks) { try { mark.clear(); } catch {} } searchMarks=[]; }
  function currentFindQuery() { return String($('find-input')?.value || ''); }
  function searchOptions() { return $('match-case')?.checked ? false : true; }
  function collectMatches(query=currentFindQuery()) {
    clearSearchMarks(); searchMatchPositions=[]; searchCurrentIndex=-1;
    if (!cm || !query) { updateFindCount(); return []; }
    const caseFold=searchOptions(); let cursor=cm.getSearchCursor(query,{line:0,ch:0},caseFold);
    while(cursor.findNext()) {
      const from=cursor.from(),to=cursor.to();
      searchMatchPositions.push({from,to});
      searchMarks.push(cm.markText(from,to,{className:'cm-searching'}));
      if(searchMatchPositions.length>=10000) break;
    }
    const sel=cm.listSelections()?.[0];
    if(sel && !cm.isReadOnly()) {
      const index=searchMatchPositions.findIndex(m=>m.from.line===sel.anchor.line&&m.from.ch===sel.anchor.ch&&m.to.line===sel.head.line&&m.to.ch===sel.head.ch);
      if(index>=0) searchCurrentIndex=index;
    }
    updateFindCount();
    return searchMatchPositions;
  }
  function updateFindCount() {
    const count=$('find-count'); if(!count)return;
    count.textContent=searchMatchPositions.length?t('matches',searchMatchPositions.length,Math.max(0,searchCurrentIndex)):' ';
  }
  function selectSearchMatch(index,{focus=true}={}) {
    if(!searchMatchPositions.length) { updateFindCount(); return false; }
    searchCurrentIndex=((index%searchMatchPositions.length)+searchMatchPositions.length)%searchMatchPositions.length;
    const m=searchMatchPositions[searchCurrentIndex];cm.setSelection(m.from,m.to,{scroll:true});cm.scrollIntoView({from:m.from,to:m.to},100);if(focus)cm.focus();updateFindCount();return true;
  }
  function doFind(direction=1) {
    const query=currentFindQuery(); if(!query||!cm)return;
    collectMatches(query);
    if(!searchMatchPositions.length){$('find-count').textContent=t('matches',0,0);return;}
    if(searchCurrentIndex>=0){selectSearchMatch(searchCurrentIndex+direction);return;}
    const cursor=cm.getCursor('head');
    let target=-1;
    if(direction>0){target=searchMatchPositions.findIndex(m=>m.from.line>cursor.line||(m.from.line===cursor.line&&m.from.ch>=cursor.ch));if(target<0)target=0;}
    else {for(let i=searchMatchPositions.length-1;i>=0;i--){const m=searchMatchPositions[i];if(m.to.line<cursor.line||(m.to.line===cursor.line&&m.to.ch<=cursor.ch)){target=i;break;}}if(target<0)target=searchMatchPositions.length-1;}
    selectSearchMatch(target);
  }
  function openFindbar(replaceMode=false) {
    $('findbar').classList.remove('hidden');$('replace-row').classList.toggle('hidden',!replaceMode);
    const selection=cm?.getSelection();if(selection&&!selection.includes('\n')&&!$('find-input').value)$('find-input').value=selection;
    applyLanguage(currentLanguage);collectMatches();$('find-input').focus();$('find-input').select();
  }
  function closeFindbar() { $('findbar').classList.add('hidden');clearSearchMarks();searchMatchPositions=[];searchCurrentIndex=-1;updateFindCount();cm?.focus(); }
  function replaceCurrent() {
    const query=currentFindQuery();if(!query||!cm)return;
    const selected=cm.getSelection();
    if(selected && (searchOptions()?selected.toLocaleLowerCase()===query.toLocaleLowerCase():selected===query)) {
      cm.replaceSelection($('replace-input').value,'around');collectMatches();doFind(1);
    } else doFind(1);
  }
  function replaceAllMatches() {
    const query=currentFindQuery();if(!query||!cm)return;
    const found=collectMatches(query).slice();if(!found.length)return;
    const replacement=String($('replace-input').value||'');
    if(!confirm(currentLanguage==='en'?`Replace all ${found.length} occurrence(s)? This can be undone with Ctrl+Z.`:`确定替换全部 ${found.length} 处吗？可使用 Ctrl+Z 撤销。`))return;
    cm.operation(()=>{for(const m of found.reverse())cm.replaceRange(replacement,m.from,m.to,'replace-all');});
    collectMatches(query);cm.focus();edDebug('find.replace-all',{count:found.length});
  }
  async function showDiffDialog(beforeText,afterText,opts={}) {
    setTxt('diff-title',opts.title||t('diff'));setTxt('diff-description',opts.description||'');
    setTxt('diff-before-title',opts.beforeTitle||t('before'));setTxt('diff-after-title',opts.afterTitle||t('after'));
    $('diff-before').replaceChildren();$('diff-after').replaceChildren();
    const result=await window.remoteEditor.diffLines(beforeText,afterText);
    const left=$('diff-before'),right=$('diff-after');
    for(const part of (result?.parts||[])){
      const lines=String(part.value??'').split('\n'); if(lines.length>1&&lines[lines.length-1]==='') lines.pop();
      for(const line of lines){
        const a=document.createElement('span'),b=document.createElement('span');a.textContent=line+'\n';b.textContent=line+'\n';
        if(part.removed){a.className='diff-del';b.textContent='';}else if(part.added){b.className='diff-ins';a.textContent='';}
        left.append(a);right.append(b);
      }
    }
    $('diff-apply-btn').classList.toggle('hidden',!opts.allowApply);
    $('diff-apply-btn').onclick=()=>{
      if(opts.allowApply&&typeof opts.onApply==='function') opts.onApply();
      $('diff-dialog').close();
    };
    $('diff-dialog').showModal();
  }
  function getDiagnosisPrompt() {
    if(!diagnostics.length) return '';
    const items=diagnostics.slice(0,100).map(d=>`- ${d.severity==='error'?'ERROR':d.severity==='warning'?'WARNING':'INFO'} ${d.line?`line ${d.line}, column ${d.column||1}: `:''}${d.message}`).join('\n');
    return [
      `Please diagnose these issues in a remote ${currentSyntax} configuration/script file.`,
      `File path: ${initialized?.remotePath||'(unknown)'}`,
      `Editor diagnostics (${diagnostics.length} total; first ${Math.min(100,diagnostics.length)} shown):`,items,
      '',
      'Please explain likely causes and propose a minimal fix. Do not reformat the whole file. Preserve every valid space, tab, blank line, line ending, quote, encoding-sensitive character and unrelated line. Do not guess where intent is ambiguous; list questions instead. If proposing a change, show a focused diff and explain each changed line.',
      'The source code itself is not included in this prompt. I will decide whether to provide it separately.'
    ].join('\n');
  }
  async function copyDiagnosis() {
    const prompt=getDiagnosisPrompt();
    if(!prompt){setTxt('save-status',t('noSource'));return;}
    await window.remoteEditor.copyText(prompt);setTxt('save-status',t('diagnosisCopied'));edDebug('diagnosis.copied',{issueCount:diagnostics.length,includesFullSource:false});
  }
  function saveFile(options={}) {
    if (savePromise) {
      edDebug('save.duplicate-request-joined', { dirty, saveInProgress: true });
      return savePromise;
    }
    const operationId = `editor-save-${Date.now()}-${++saveSequence}`;
    edDebug('save.request', { operationId, forceOverwrite: options.forceOverwrite === true, dirty, textLength: cm?.getValue()?.length ?? 0 });
    const tracked = saveFileOnce({ ...options, operationId });
    const wrapped = tracked.finally(() => {
      if (savePromise === wrapped) savePromise = null;
      edDebug('save.request-settled', { operationId, dirty, saveInProgress: !!savePromise });
    });
    savePromise = wrapped;
    return wrapped;
  }
  async function saveFileOnce({forceOverwrite=false, expectedOverride=null, operationId=null}={}) {
    if(!cm||!snapshot) return false;
    const text=cm.getValue(); const fmt=selectedFormat();
    setTxt('save-status',t('saving'));$('save-btn').disabled=true;
    try {
      edDebug('save.begin',{operationId, textLength:text.length, encoding:fmt.encoding, bom:fmt.bom, eolChoice:effectiveEol(), forceOverwrite:!!forceOverwrite});
      const result=await window.remoteEditor.save({operationId,content:text,baseHash:expectedOverride||baselineHash,encoding:fmt.encoding,bom:fmt.bom,eolChoice:effectiveEol(),originalText:baselineText,originalEols:baselineEols,forceOverwrite});
      if(result?.conflict){
        remoteConflict=result;
        setTxt('save-status',t('changedRemote'));
        $('conflict-description').textContent=t('conflictDesc');
        $('conflict-local').textContent=text;
        $('conflict-remote').textContent=result.remoteContent||'';
        $('conflict-warning').textContent=t('conflictWarning');
        $('conflict-title').textContent=t('conflictTitle');
        $('conflict-local-title').textContent=t('sourceText');$('conflict-remote-title').textContent=t('remoteText');
        $('conflict-dialog').showModal();
        edDebug('save.conflict',{operationId,localBytes:new TextEncoder().encode(text).length,remoteBytes:result.remoteSize||0,forceOverwrite:!!forceOverwrite});
        return false;
      }
      if(!result?.ok) throw new Error(result?.message||t('saveFailed'));
      baselineText=text;baselineHash=result.hash;baselineEols=result.eols||[];
      baselineEncoding=fmt.encoding;baselineBom=fmt.bom;
      snapshot={...snapshot,hash:result.hash,content:text,eols:baselineEols,eolLabel:result.eolLabel||displayEol(),defaultEol:result.defaultEol||snapshot.defaultEol,encoding:fmt.encoding,bom:fmt.bom,metadata:result.metadata||snapshot.metadata};
      $('eol-select').value='preserve';
      updateDirty();
      if(!dirty) await window.remoteEditor.deleteDraft().catch(()=>{});
      setRemoteStatus(t('saveOk'),'ok');setTxt('save-status',t('saveOk'));
      $('encoding-status').textContent=formatLabel(fmt.encoding,fmt.bom);
      edDebug('save.success',{operationId,byteLength:result.byteLength,encoding:fmt.encoding,bom:fmt.bom,eol:result.eolLabel,metadataPreserved:result.metadataPreserved||{},cleanupWarning:!!result.cleanupWarning});
      if(result.cleanupWarning) alert(result.cleanupWarning);
      return true;
    } catch(error) {
      setTxt('save-status',`${t('saveFailed')}: ${error.message||error}`);setRemoteStatus(t('saveFailed'),'error');
      edDebug('save.error',{operationId,error:String(error?.stack||error),length:text.length,encoding:fmt.encoding});
      alert(`${t('saveFailed')}\n\n${error.message||error}`);return false;
    } finally {$('save-btn').disabled=!dirty;}
  }
  async function runRemoteShellCheck() {
    if(currentSyntax!=='shell'){alert(currentLanguage==='en'?'Remote sh -n is intended for Shell scripts.':'远端 sh -n 只适用于 Shell 脚本。');return;}
    $('remote-check-btn').disabled=true;setTxt('save-status',t('shellCheckStart'));
    try {
      const result=await window.remoteEditor.checkShellRemote(cm.getValue());
      if(result?.ok){diagnostics=mergeDiagnostics(diagnostics.filter(d=>d.source!=='remote-sh'),(result.diagnostics||[]).map(d=>({...d,source:'remote-sh'})));renderDiagnostics();setTxt('save-status',result.passed?t('shellCheckOk'):t('shellCheckFail'));setRemoteStatus(result.passed?t('shellCheckOk'):t('shellCheckFail'),result.passed?'ok':'error');}
      else {setTxt('save-status',`${t('shellCheckUnavailable')} ${result?.message||''}`);setRemoteStatus(t('shellCheckUnavailable'),'warn');}
      edDebug('shell.remote-check-result',{ok:!!result?.ok,passed:!!result?.passed,diagnosticCount:result?.diagnostics?.length||0});
    } catch(error){setTxt('save-status',`${t('shellCheckUnavailable')} ${error.message||error}`);edDebug('shell.remote-check-error',{error:String(error?.message||error)});}
    finally {$('remote-check-btn').disabled=false;}
  }
  function scheduleWhitespaceRefresh(){clearTimeout(whitespaceRefreshTimer);whitespaceRefreshTimer=setTimeout(applyWhitespaceMarks,70);}
  function clearWhitespaceMarks(resetViewport=true){ for(const mark of whitespaceMarks)try{mark.clear();}catch{} whitespaceMarks=[];if(resetViewport)whitespaceViewportKey=''; }
  function applyWhitespaceMarks() {
    if(!cm) return;
    cm.setOption('showInvisibles', $('show-invisibles').checked);
    if(!$('show-invisibles').checked) {clearWhitespaceMarks();return;}
    const viewport=cm.getViewport();
    const key=`${viewport.from}:${viewport.to}`;
    if(key===whitespaceViewportKey)return;
    clearWhitespaceMarks(false);whitespaceViewportKey=key;
    for(let line=Math.max(0,viewport.from);line<Math.min(cm.lineCount(),viewport.to+1);line++){
      const content=cm.getLine(line);let match;const re=/[ \t\u00a0\u200b\u200c\u200d\u2060\ufeff]/g;
      while((match=re.exec(content))){
        const span=document.createElement('span');span.className=match[0]==='\t'?'invisible-tab':'invisible-mark';
        span.textContent=match[0]===' '?'·':match[0]==='\t'?'→':match[0]==='\u00a0'?'⍽':match[0]==='\ufeff'?'BOM':'◇';
        span.title=match[0]===' '?'SPACE':match[0]==='\t'?'TAB':`U+${match[0].charCodeAt(0).toString(16).toUpperCase().padStart(4,'0')}`;
        whitespaceMarks.push(cm.markText({line,ch:match.index},{line,ch:match.index+1},{replacedWith:span,clearOnEnter:false,inclusiveLeft:false,inclusiveRight:false}));
      }
      if(line<cm.lastLine()) {
        const forced=effectiveEol();
        const ending=forced!=='preserve'?(forced==='CRLF'?'\r\n':forced==='CR'?'\r':'\n'):(baselineEols[line]||snapshot?.defaultEol||'\n');
        const label=ending==='\r\n'?'CRLF':ending==='\r'?'CR':'LF';
        const marker=document.createElement('span');marker.className='invisible-eol';marker.textContent=`↵${label}`;marker.title=`Line ending: ${label}`;
        whitespaceMarks.push(cm.setBookmark({line,ch:content.length},{widget:marker,insertLeft:false}));
      }
    }
  }
  function createMonacoAdapter(host, initialValue) {
    if (!window.monaco?.editor || !window.monaco?.languages) throw new Error('Monaco Editor 尚未加载完成');
    const m = window.monaco;
    try {
      m.editor.defineTheme('n1pilot-dark', {
        base: 'vs-dark', inherit: true,
        rules: [
          { token: 'invalid', foreground: 'FF6678', fontStyle: 'underline' },
          { token: 'string.invalid', foreground: 'FF6678', fontStyle: 'underline' }
        ],
        colors: {
          'editor.background': '#0a1220', 'editor.foreground': '#d5e2f3',
          'editorLineNumber.foreground': '#71839f', 'editorLineNumber.activeForeground': '#dce8fb',
          'editor.lineHighlightBackground': '#3e5d8c30', 'editorCursor.foreground': '#e5efff',
          'editor.selectionBackground': '#264b7d', 'editor.inactiveSelectionBackground': '#203a5b',
          'editorBracketMatch.background': '#31513e', 'editorBracketMatch.border': '#6fdd98',
          'editorError.foreground': '#ff5268', 'editorWarning.foreground': '#f4c46b',
          'editorGutter.background': '#0a1220', 'editorOverviewRuler.border': '#2d3a50'
        }
      });
    } catch {}
    const languageMap = {
      shell:'shell', json:'json', yaml:'yaml', properties:'ini', toml:'ini', lua:'lua',
      python:'python', javascript:'javascript', xml:'xml', css:'css', sql:'sql', diff:'diff',
      dockerfile:'dockerfile', text:'plaintext'
    };
    const languageId = languageMap[currentSyntax] || 'plaintext';
    const editor = m.editor.create(host, {
      value: String(initialValue ?? ''), language: languageId, theme: 'n1pilot-dark',
      automaticLayout: true, minimap: { enabled: false }, lineNumbers: 'on', lineNumbersMinChars: 3,
      glyphMargin: false, folding: true, foldingHighlight: true,
      fontFamily: "Consolas, 'Cascadia Code', 'Courier New', monospace", fontSize: 14, lineHeight: 22,
      tabSize: 4, insertSpaces: false, autoIndent: 'none',
      autoClosingBrackets: 'never', autoClosingQuotes: 'never', autoSurround: 'never',
      formatOnPaste: false, formatOnType: false, trimAutoWhitespace: false,
      bracketPairColorization: { enabled: true }, matchBrackets: 'always',
      wordWrap: 'off', renderWhitespace: 'none', renderControlCharacters: false,
      cursorSmoothCaretAnimation: 'off', smoothScrolling: false, scrollBeyondLastLine: false,
      contextmenu: true, mouseWheelZoom: false, quickSuggestions: false, suggestOnTriggerCharacters: false,
      acceptSuggestionOnCommitCharacter: false, tabCompletion: 'off', snippetSuggestions: 'none',
      guides: { indentation: false, highlightActiveIndentation: false, bracketPairs: true },
      padding: { top: 10, bottom: 10 },
      scrollbar: { vertical: 'auto', horizontal: 'auto', alwaysConsumeMouseWheel: false },
      stickyScroll: { enabled: false }, unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false, nonBasicASCII: false }
    });
    const listeners = new Map();
    const state = {};
    let lineWrapping = false, showInvisibles = false, canUndo = false, canRedo = false;
    let pendingPasteText = null;
    let editBatchDepth = 0;
    let batchedEdits = [];
    const emit = (name, ...args) => { for (const fn of listeners.get(name) || []) { try { fn(...args); } catch (error) { console.error(error); } } };
    const model = () => editor.getModel();
    const toMonacoPosition = (p = {}) => ({
      lineNumber: Math.max(1, Math.min(model()?.getLineCount() || 1, Math.trunc(Number(p.line) || 0) + 1)),
      column: Math.max(1, Math.min((model()?.getLineMaxColumn(Math.max(1, Math.min(model()?.getLineCount() || 1, Math.trunc(Number(p.line) || 0) + 1))) || 1), Math.trunc(Number(p.ch) || 0) + 1))
    });
    const toCMPosition = (p = {}) => ({ line: Math.max(0, Number(p.lineNumber || 1) - 1), ch: Math.max(0, Number(p.column || 1) - 1) });
    const toMonacoRange = (from, to = from) => {
      const a = toMonacoPosition(from), b = toMonacoPosition(to);
      return new m.Range(a.lineNumber, a.column, b.lineNumber, b.column);
    };
    function addDecoration(from, to, options = {}) {
      const range = toMonacoRange(from, to);
      const decoration = { range, options: { stickiness: m.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges } };
      if (options.className) {
        if (String(options.className).includes('diagnostic-warn-line')) {
          decoration.options.className = options.className;
          decoration.options.isWholeLine = true;
        } else decoration.options.inlineClassName = options.className;
      }
      if (options.replacedWith) {
        const element = options.replacedWith;
        const contentText = String(element.textContent || '');
        decoration.options.after = { contentText, inlineClassName: element.className || options.className || 'invisible-mark' };
        if (element.title) decoration.options.hoverMessage = { value: element.title };
      }
      if (options.widget?.textContent != null) {
        decoration.options.after = { contentText: String(options.widget.textContent), inlineClassName: options.widget.className || 'invisible-eol' };
        if (options.widget.title) decoration.options.hoverMessage = { value: options.widget.title };
      }
      const ids = editor.deltaDecorations([], [decoration]);
      let cleared = false;
      return { clear() { if (cleared) return; cleared = true; try { editor.deltaDecorations(ids, []); } catch {} } };
    }
    const facade = {
      state,
      on(name, callback) { const list = listeners.get(name) || []; list.push(callback); listeners.set(name, list); },
      getValue() { return editor.getValue(); },
      setValue(value) { editor.setValue(String(value ?? '')); canUndo = false; canRedo = false; },
      lineCount() { return model()?.getLineCount() || 1; },
      lastLine() { return Math.max(0, (model()?.getLineCount() || 1) - 1); },
      getLine(line) { return model()?.getLineContent(Math.max(1, Math.min(facade.lineCount(), Math.trunc(Number(line) || 0) + 1))) || ''; },
      getCursor(which) {
        const selection = editor.getSelection();
        const position = which === 'head' && selection ? selection.getPosition() : editor.getPosition();
        return toCMPosition(position || { lineNumber: 1, column: 1 });
      },
      setCursor(position) { editor.setPosition(toMonacoPosition(position)); },
      getSelection() { const selection = editor.getSelection(); return selection && model() ? model().getValueInRange(selection) : ''; },
      listSelections() {
        return (editor.getSelections() || []).map((selection) => ({
          anchor: toCMPosition({ lineNumber: selection.selectionStartLineNumber, column: selection.selectionStartColumn }),
          head: toCMPosition({ lineNumber: selection.positionLineNumber, column: selection.positionColumn })
        }));
      },
      setSelection(from, to = from) { editor.setSelection(new m.Selection(from.line + 1, from.ch + 1, to.line + 1, to.ch + 1)); },
      replaceSelection(text) {
        const selected = editor.getSelection(); if (!selected || !model()) return;
        const start = model().getOffsetAt({ lineNumber: selected.startLineNumber, column: selected.startColumn });
        const value = String(text ?? '');
        editor.executeEdits('n1pilot-edit', [{ range: selected, text: value, forceMoveMarkers: true }]);
        const end = model().getPositionAt(Math.min(model().getValueLength(), start + value.length));
        editor.setPosition(end); editor.focus();
      },
      replaceRange(text, from, to, origin = 'n1pilot-edit') {
        if (!model()) return;
        const range = toMonacoRange(from, to);
        const edit = { range, text: String(text ?? ''), forceMoveMarkers: true };
        if (editBatchDepth > 0) batchedEdits.push(edit);
        else editor.executeEdits(origin, [edit]);
      },
      operation(callback) {
        editBatchDepth++;
        try { return callback(); }
        finally {
          editBatchDepth--;
          if (editBatchDepth === 0 && batchedEdits.length) {
            const edits = batchedEdits;
            batchedEdits = [];
            editor.executeEdits('n1pilot-batched-edit', edits);
          }
        }
      },
      markText(from, to, options = {}) { return addDecoration(from, to, options); },
      setBookmark(position, options = {}) { return addDecoration(position, position, options); },
      getSearchCursor(query, start = { line: 0, ch: 0 }, caseFold = true) {
        const textModel = model();
        if (!textModel || !String(query)) return { findNext: () => false, from: () => null, to: () => null };
        const startPos = toMonacoPosition(start);
        const matches = textModel.findMatches(String(query), false, false, !caseFold, null, false, 10000)
          .filter((match) => match.range.startLineNumber > startPos.lineNumber || (match.range.startLineNumber === startPos.lineNumber && match.range.startColumn >= startPos.column));
        let index = -1, current = null;
        return {
          findNext() { index++; current = matches[index] || null; return !!current; },
          from() { return current ? toCMPosition({ lineNumber: current.range.startLineNumber, column: current.range.startColumn }) : null; },
          to() { return current ? toCMPosition({ lineNumber: current.range.endLineNumber, column: current.range.endColumn }) : null; }
        };
      },
      historySize() { return { undo: canUndo, redo: canRedo }; },
      undo() { editor.trigger('n1pilot', 'undo', null); },
      redo() { editor.trigger('n1pilot', 'redo', null); },
      clearHistory() { const value = editor.getValue(); editor.setValue(value); canUndo = false; canRedo = false; },
      isReadOnly() { return false; },
      getOption(name) { if (name === 'lineWrapping') return lineWrapping; if (name === 'showInvisibles') return showInvisibles; return undefined; },
      setOption(name, value) {
        if (name === 'lineWrapping') { lineWrapping = !!value; editor.updateOptions({ wordWrap: lineWrapping ? 'on' : 'off' }); }
        if (name === 'showInvisibles') { showInvisibles = !!value; editor.updateOptions({ renderWhitespace: showInvisibles ? 'all' : 'none', renderControlCharacters: showInvisibles }); }
      },
      getScrollInfo() { return { left: editor.getScrollLeft(), top: editor.getScrollTop() }; },
      scrollTo(left, top) { editor.setScrollLeft(Math.max(0, Number(left) || 0)); editor.setScrollTop(Math.max(0, Number(top) || 0)); },
      scrollIntoView(value) {
        const position = value?.from || value;
        if (position && Number.isFinite(Number(position.line))) editor.revealLineInCenter(Math.max(1, Math.trunc(position.line) + 1));
      },
      getViewport() {
        const ranges = editor.getVisibleRanges() || [];
        if (!ranges.length) return { from: 0, to: facade.lastLine() };
        return { from: Math.max(0, ranges[0].startLineNumber - 1), to: Math.max(0, ranges[ranges.length - 1].endLineNumber - 1) };
      },
      refresh() { editor.layout(); },
      focus() { editor.focus(); },
      getEditor() { return editor; },
      dispose() { try { editor.dispose(); } catch {} }
    };
    host.addEventListener('paste', (event) => {
      try { pendingPasteText = event.clipboardData?.getData('text/plain') ?? ''; } catch { pendingPasteText = ''; }
      setTimeout(() => { pendingPasteText = null; }, 0);
    }, true);
    editor.onDidChangeModelContent((event) => {
      if (event.isUndoing) { canRedo = true; }
      else if (event.isRedoing) { canUndo = true; }
      else { canUndo = true; canRedo = false; }
      const pasted = pendingPasteText !== null;
      const change = { origin: pasted ? 'paste' : 'input', text: pasted ? String(pendingPasteText).split(/\r\n|\n|\r/) : event.changes.map((change) => change.text || '') };
      emit('change', facade, change);
      emit('inputRead', facade, change);
      pendingPasteText = null;
    });
    editor.onDidChangeCursorPosition(() => emit('cursorActivity', facade));
    editor.onDidScrollChange(() => { emit('scroll', facade); emit('viewportChange', facade); });
    editor.onDidChangeModel(() => { emit('viewportChange', facade); });
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => saveFile());
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyF, () => openFindbar(false));
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyH, () => openFindbar(true));
    editor.addCommand(m.KeyCode.F3, () => doFind(1));
    editor.addCommand(m.KeyMod.Shift | m.KeyCode.F3, () => doFind(-1));
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyG, () => editor.trigger('n1pilot', 'editor.action.gotoLine', null));
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Slash, () => editor.trigger('n1pilot', 'editor.action.commentLine', null));
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyMod.Shift | m.KeyCode.KeyC, () => copyDiagnosis());
    // Literal Enter/Tab behavior is intentional: no auto-indentation, paired bracket or quote insertion.
    editor.addCommand(m.KeyCode.Enter, () => facade.replaceSelection('\n'));
    editor.addCommand(m.KeyCode.Tab, () => facade.replaceSelection('\t'));
    return facade;
  }
  function wireEditor() {
    cm = createMonacoAdapter($('editor-host'), snapshot.content);
    $('loading-panel').classList.add('hidden'); $('unsupported-panel').classList.add('hidden'); $('editor-host').classList.remove('hidden');
    cm.on('change', (_editor, change) => {
      if (isApplyingProgrammaticChange) return;
      updateDirty(); scheduleValidation({ showPasteDialog: change.origin === 'paste' });
      if ($('show-invisibles').checked) { whitespaceViewportKey = ''; clearTimeout(whitespaceRefreshTimer); whitespaceRefreshTimer = setTimeout(applyWhitespaceMarks, 80); }
      if (!$('findbar').classList.contains('hidden') && currentFindQuery()) collectMatches();
    });
    cm.on('cursorActivity', () => updateStateUI());
    cm.on('viewportChange', () => { if ($('show-invisibles').checked) scheduleWhitespaceRefresh(); });
    cm.on('scroll', () => { if ($('show-invisibles').checked) scheduleWhitespaceRefresh(); });
    cm.on('inputRead', (_editor, change) => {
      if (change.origin === 'paste' && change.text?.some(x => /[\u00a0\u200b\u200c\u200d\u2060\ufeff“”‘’：＝，；（）［］｛｝]/.test(x))) scheduleValidation({ showPasteDialog: true });
    });
    cm.refresh(); updateDirty(); updateStateUI(); scheduleValidation();
    setTimeout(() => cm?.focus(), 80);
  }
  function unsupported(message) {
    $('loading-panel').classList.add('hidden');$('editor-host').classList.add('hidden');$('unsupported-panel').classList.remove('hidden');
    setTxt('unsupported-title',t('unsupported'));setTxt('unsupported-message',message);setRemoteStatus(t('loadFailed'),'error');edDebug('load.unsupported',{message:String(message).slice(0,200)});
  }
  function applyLanguage(language) {
    currentLanguage=language==='en'?'en':'zh';document.documentElement.lang=currentLanguage==='en'?'en':'zh-CN';
    const pairs={
      'save-btn':t('save'),'find-label':t('findLabel'),'find-prev-btn':t('previous'),'find-next-btn':t('next'),'replace-label':t('replaceLabel'),'replace-one-btn':t('replaceOne'),'replace-all-btn':t('replaceAll'),'find-close-btn':t('close'),'undo-btn':currentLanguage==='en'?'Undo':'撤销','redo-btn':currentLanguage==='en'?'Redo':'重做','find-btn':t('find'),'replace-btn':t('replace'),'wrap-btn':cm?.getOption('lineWrapping')?t('wrapOn'):t('wrapOff'),'check-btn':t('check'),'remote-check-btn':t('remoteCheck'),'copy-diagnosis-btn':t('copyDiagnosis'),
      'show-invisibles':null,'debug-toggle':null,'debug-log-btn':t('log'),'encoding-label':t('encoding'),'eol-label':t('eol'),'diagnostics-title':t('diagnostics'),'diagnostics-clear-btn':t('clear'),'diagnostics-toggle-btn':$('diagnostics-panel').classList.contains('collapsed')?t('expand'):t('collapse'),
      'loading-title':t('loading'),'loading-detail':t('doNotClose'),'unsupported-title':t('unsupported'),'suggestion-title':t('markdownDetected'),'suggestion-preview-btn':t('previewFence'),'suggestion-copy-btn':t('copyDiagnosis'),'suggestion-keep-btn':t('keep'),'diff-cancel-btn':currentLanguage==='en'?'Cancel':'取消','conflict-cancel-btn':t('cancelSave'),
      'diff-title':t('diff'),'diff-before-title':t('before'),'diff-after-title':t('after'),'conflict-title':t('conflictTitle'),'conflict-local-title':t('sourceText'),'conflict-remote-title':t('remoteText'),'conflict-warning':t('conflictWarning'),'conflict-copy-btn':t('conflictCopy'),'conflict-overwrite-btn':t('overwrite'),
      'close-title':t('closeTitle'),'close-description':t('closeDesc'),'close-cancel-btn':t('closeCancel'),'close-discard-btn':t('closeDiscard'),'close-save-btn':t('closeSave'),
      'recovery-title':t('recoveryTitle'),'recovery-description':t('recoveryDesc'),'recovery-ignore-btn':t('recoveryIgnore')
    };
    for(const [id,value] of Object.entries(pairs))if(value!==null)setTxt(id,value);
    $('show-invisibles').parentElement.lastChild.textContent=t('showInvisible');$('debug-toggle').parentElement.lastChild.textContent=t('debug');
    const select=$('eol-select');const optionLabels={preserve:t('preserve'),LF:t('LF'),CRLF:t('CRLF'),CR:t('CR')};for(const o of select.options)o.textContent=optionLabels[o.value]||o.value;
    const encLabels={utf8:t('utf8'),utf8bom:t('utf8bom'),utf16le:t('utf16le'), 'utf16le-bom':t('utf16lebom'),utf16be:t('utf16be'),'utf16be-bom':t('utf16bebom'),windows1252:t('windows1252'),latin1:t('latin1')};for(const o of $('encoding-select').options)o.textContent=encLabels[o.value]||o.value;
    $('language-btn').textContent=currentLanguage==='en'?'中文':'EN';
    const matchCase=$('match-case');if(matchCase?.parentElement)matchCase.parentElement.lastChild.textContent=t('matchCase');
    const findInput=$('find-input'),replaceInput=$('replace-input');if(findInput)findInput.placeholder=currentLanguage==='en'?'Search text':'输入要查找的文本';if(replaceInput)replaceInput.placeholder=currentLanguage==='en'?'Replacement text':'输入替换文本';
    if(cm){renderDiagnostics();updateDirty();}
  }
  async function offerRecoveryDrafts(drafts) {
    selectedRecoveryDrafts=drafts||[]; if(!selectedRecoveryDrafts.length)return;
    const root=$('recovery-choices');root.replaceChildren();
    for(const draft of selectedRecoveryDrafts){
      const card=document.createElement('button');card.type='button';card.className='recovery-card';
      const name=document.createElement('strong');name.textContent=`${draft.displayName||'Untitled'} — ${t('draftAt')} ${new Date(draft.savedAt||Date.now()).toLocaleString()}`;
      const details=document.createElement('small');details.textContent=`${draft.lineCount||0} lines · ${draft.baseHash===snapshot.hash?(currentLanguage==='en'?'remote version unchanged':'远程版本未变化'):(currentLanguage==='en'?'remote version differs':'远程版本已变化')} · ${bytesText(new TextEncoder().encode(draft.content||'').length)}`;
      card.append(name,details);card.addEventListener('click',()=>{restoreDraft(draft);$('recovery-dialog').close();});root.append(card);
    }
    $('recovery-dialog').showModal();
  }
  async function restoreDraft(draft) {
    if(!cm||!draft)return;
    isApplyingProgrammaticChange=true;
    cm.setValue(String(draft.content??''));cm.clearHistory();
    baselineText=String(draft.originalText??snapshot.content??'');baselineHash=String(draft.baseHash||snapshot.hash);baselineEols=Array.isArray(draft.originalEols)?draft.originalEols:[];
    baselineEncoding=String(draft.originalEncoding||snapshot.encoding);baselineBom=!!draft.originalBom;
    $('encoding-select').value=encodingSelectValue(String(draft.encoding||snapshot.encoding),!!draft.bom);
    $('eol-select').value=draft.eolChoice||'preserve';
    if(draft.cursor)cm.setCursor({line:Math.min(cm.lastLine(),Math.max(0,draft.cursor.line||0)),ch:Math.max(0,draft.cursor.ch||0)});
    if(draft.scrollInfo)setTimeout(()=>{try{cm.scrollTo(Number(draft.scrollInfo.left)||0,Number(draft.scrollInfo.top)||0);}catch{}},0);
    isApplyingProgrammaticChange=false;
    dirty=cm.getValue()!==baselineText||formatDirty();window.remoteEditor.setDirty(dirty);updateStateUI();
    let copiedSafely=false;
    try {
      const fmt=selectedFormat();
      await window.remoteEditor.saveDraft({content:cm.getValue(),originalText:baselineText,originalEols:baselineEols,baseHash:baselineHash,encoding:fmt.encoding,bom:fmt.bom,eolChoice:effectiveEol(),originalEncoding:baselineEncoding,originalBom:baselineBom,cursor:cm.getCursor(),scrollInfo:cm.getScrollInfo(),lineCount:cm.lineCount()});
      copiedSafely=true;
    } catch(error) { setTxt('save-status',currentLanguage==='en'?'Draft recovery copy failed; the old recovery draft was retained.':'恢复草稿另存失败，旧草稿已保留。'); }
    if(copiedSafely) await window.remoteEditor.discardRecoveryDraft(draft.draftId).catch(()=>{});
    if(baselineHash!==snapshot.hash){setRemoteStatus(t('remoteChangedDraft'),'warn');setTxt('save-status',t('remoteChangedDraft'));}
    else if(copiedSafely) setTxt('save-status',t('restored'));
    edDebug('draft.restored',{draftId:draft.draftId,baseHashMatchesCurrent:baselineHash===snapshot.hash,draftCopiedSafely:copiedSafely,lineCount:cm.lineCount()});scheduleValidation();scheduleDraftSave();
  }
  async function initialize() {
    try {
      const result=await window.remoteEditor.initialize();initialized=result;
      if(!result?.ok){unsupported(result?.message||t('unsupported'));return;}
      snapshot=result.snapshot;
      baselineText=snapshot.content;baselineHash=snapshot.hash;baselineEncoding=snapshot.encoding;baselineBom=!!snapshot.bom;baselineEols=snapshot.eols||[];
      currentLanguage=result.language==='en'?'en':'zh';currentSyntax=modeForPath(result.remotePath);debugEnabled=!!result.debugEnabled;
      document.title=`${result.displayName} — N1PilotDesktop Remote Editor`;
      setTxt('file-name',result.displayName);setTxt('file-path',result.remotePath);$('file-path').title=result.remotePath;
      setTxt('language-mode-status',currentSyntax.toUpperCase()==='TEXT'?'Plain Text':currentSyntax.toUpperCase());setTxt('language-label',currentSyntax.toUpperCase()==='TEXT'?'Plain Text':currentSyntax.toUpperCase());
      applyLanguage(currentLanguage);$('debug-toggle').checked=debugEnabled;$('encoding-select').value=encodingSelectValue(snapshot.encoding,snapshot.bom);$('encoding-select').disabled=false;$('eol-select').disabled=false;
      $('encoding-select').addEventListener('change',()=>{updateDirty();scheduleValidation();edDebug('encoding.selected',{encoding:selectedFormat().encoding,bom:selectedFormat().bom});});
      $('eol-select').addEventListener('change',()=>{updateDirty();edDebug('line-ending.selected',{choice:effectiveEol()});});
      $('save-btn').addEventListener('click',()=>saveFile());$('undo-btn').addEventListener('click',()=>cm?.undo());$('redo-btn').addEventListener('click',()=>cm?.redo());
      $('find-btn').addEventListener('click',()=>openFindbar(false));$('replace-btn').addEventListener('click',()=>openFindbar(true));$('wrap-btn').addEventListener('click',()=>{const on=!cm.getOption('lineWrapping');cm.setOption('lineWrapping',on);setTxt('wrap-btn',on?t('wrapOn'):t('wrapOff'));$('wrap-btn').classList.toggle('active',on);whitespaceViewportKey='';if($('show-invisibles').checked)scheduleWhitespaceRefresh();edDebug('wrap.changed',{enabled:on});});
      $('find-prev-btn').addEventListener('click',()=>doFind(-1));$('find-next-btn').addEventListener('click',()=>doFind(1));$('replace-one-btn').addEventListener('click',replaceCurrent);$('replace-all-btn').addEventListener('click',replaceAllMatches);$('find-close-btn').addEventListener('click',closeFindbar);$('match-case').addEventListener('change',()=>collectMatches());$('find-input').addEventListener('input',()=>{collectMatches();if(searchMatchPositions.length)selectSearchMatch(0,{focus:false});});$('find-input').addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();doFind(e.shiftKey?-1:1);}if(e.key==='Escape'){e.preventDefault();closeFindbar();}});$('replace-input').addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();replaceCurrent();}if(e.key==='Escape'){e.preventDefault();closeFindbar();}});$('check-btn').addEventListener('click',()=>validateContent());$('remote-check-btn').addEventListener('click',runRemoteShellCheck);$('copy-diagnosis-btn').addEventListener('click',copyDiagnosis);
      $('show-invisibles').addEventListener('change',()=>{whitespaceViewportKey='';applyWhitespaceMarks();});$('debug-toggle').addEventListener('change',async()=>{const r=await window.remoteEditor.setDebugEnabled($('debug-toggle').checked);debugEnabled=!!r.enabled;setTxt('save-status',debugEnabled?t('debugOn'):t('debugOff'));});
      $('debug-log-btn').addEventListener('click',async()=>{try{await window.remoteEditor.openDebugLogFolder();}catch(e){alert(`${t('logOpenFail')}: ${e.message||e}`);}});
      $('language-btn').addEventListener('click',()=>window.remoteEditor.setLanguage(currentLanguage==='en'?'zh':'en'));
      $('diagnostics-clear-btn').addEventListener('click',()=>{diagnostics=[];renderDiagnostics();});$('diagnostics-toggle-btn').addEventListener('click',()=>{$('diagnostics-panel').classList.toggle('collapsed');setTxt('diagnostics-toggle-btn',$('diagnostics-panel').classList.contains('collapsed')?t('expand'):t('collapse'));});
      $('suggestion-copy-btn').addEventListener('click',copyDiagnosis);
      $('suggestion-preview-btn').addEventListener('click',async()=>{if(!suggestionText)return;$('suggestion-dialog').close();await showDiffDialog(cm.getValue(),suggestionText,{title:t('diff'),description:currentLanguage==='en'?'Review every suggested change below. Nothing changes until you apply this preview.':'请检查下面的全部建议修改。只有点击应用后才会改变内容。',beforeTitle:t('before'),afterTitle:t('after'),allowApply:true,onApply:()=>{cm.operation(()=>{cm.replaceRange(suggestionText,{line:0,ch:0},{line:cm.lastLine(),ch:cm.getLine(cm.lastLine()).length},'n1pilot-cleanup');});cm.focus();scheduleValidation();}});});
      $('conflict-copy-btn').addEventListener('click',async()=>{const msg=`Remote file conflict: ${initialized.remotePath}\nMy edited content differs from the current remote file.\nPlease help me compare the two versions and propose a minimal merge. Do not assume either version is correct. Preserve all unrelated whitespace and line endings. Full file contents are not included in this prompt.`;await window.remoteEditor.copyText(msg);setTxt('save-status',t('diagnosisCopied'));});
      $('conflict-overwrite-btn').addEventListener('click',async()=>{if(!remoteConflict)return;$('conflict-dialog').close();const currentHash=remoteConflict.currentHash;remoteConflict=null;await saveFile({forceOverwrite:true,expectedOverride:currentHash});});
      $('recovery-ignore-btn').addEventListener('click',async()=>{for(const d of selectedRecoveryDrafts)await window.remoteEditor.discardRecoveryDraft(d.draftId).catch(()=>{});$('recovery-dialog').close();});
      $('close-cancel-btn').addEventListener('click',()=>{pendingClose=false;$('close-dialog').close();edDebug('close.user-cancel');window.remoteEditor.closeDecision('cancel');});
      $('close-discard-btn').addEventListener('click',async()=>{if(savePromise&&!window.confirm(t('saveInProgressDiscardConfirm')))return;pendingClose=false;$('close-dialog').close();edDebug('close.user-discard',{dirty,saveInProgress:!!savePromise,remoteSaveMayStillComplete:!!savePromise});await window.remoteEditor.deleteDraft().catch((error)=>edDebug('close.discard-draft-error',{error:String(error?.message||error)}));window.remoteEditor.closeDecision('discard');});
      $('close-save-btn').addEventListener('click',async()=>{
        if (!pendingClose) return;
        edDebug('close.save-and-close.request',{dirty,saveInProgress:!!savePromise,dialogRemainsOpen:true});
        // Keep the decision dialog open while the save is pending. If an SFTP
        // callback stalls, the user can still choose Discard or Cancel.
        const ok=await saveFile();
        if (!pendingClose || !$('close-dialog').open) {
          edDebug('close.save-result-after-user-decision',{ok,dirty});
          return;
        }
        if(ok&&!dirty) {
          edDebug('close.save-and-close.allowed',{dirty});
          pendingClose=false;
          $('close-dialog').close();
          window.remoteEditor.closeDecision('close');
        } else {
          // Keep the dialog open so the user can retry, discard, or continue editing.
          // Do not leave the main-process closePrompting guard stuck.
          edDebug('close.save-and-close-stopped',{ok,dirty,saveInProgress:!!savePromise,dialogRemainsOpen:true});
        }
      });
      $('close-dialog').addEventListener('close',()=>{if(pendingClose){pendingClose=false;window.remoteEditor.closeDecision('cancel');}});
      wireEditor();setRemoteStatus(result.connected?t('ready'):(currentLanguage==='en'?'SSH connection not active':'SSH 会话暂不可用'),result.connected?'ok':'warn');
      setTxt('save-status',t('ready'));edDebug('window.initialized',{remotePath:result.remotePath,language:currentLanguage,syntax:currentSyntax,encoding:snapshot.encoding,eol:snapshot.eolLabel,bytes:snapshot.byteLength,debugEnabled:result.debugEnabled});
      await offerRecoveryDrafts(result.drafts||[]);
    } catch(error){unsupported(`${t('loadFailed')}: ${error.message||error}`);edDebug('initialize.error',{error:String(error?.stack||error)});}
  }
  window.remoteEditor.on('editor:language',(language)=>{applyLanguage(language);});
  window.remoteEditor.on('editor:flush-draft-and-quit', async () => {
    edDebug('app-quit.draft-flush-received',{dirty,saveInProgress:!!savePromise});
    try {
      clearTimeout(draftTimer);
      if (dirty && cm && snapshot) await persistCurrentDraft();
      window.remoteEditor.flushDraftComplete({ ok: true });
      edDebug('app-quit.draft-flushed',{dirty,lineCount:cm?.lineCount()||0});
    } catch (error) {
      window.remoteEditor.flushDraftComplete({ ok: false, error: String(error?.message || error) });
      edDebug('app-quit.draft-flush-error',{error:String(error?.message||error)});
    }
  });
  window.remoteEditor.on('editor:close-request',()=>{
    edDebug('close.request-received',{dirty,saveInProgress:!!savePromise,pendingClose});
    if(!dirty){window.remoteEditor.deleteDraft().catch(()=>{});window.remoteEditor.closeDecision('close');return;}
    pendingClose=true;
    setTxt('close-title',t('closeTitle'));setTxt('close-description',t('closeDesc'));$('close-dialog').showModal();
  });
  window.addEventListener('keydown',(event)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();saveFile();}if(event.key==='Escape'&&!$('findbar').classList.contains('hidden')&&!$('suggestion-dialog').open&&!$('diff-dialog').open&&!$('conflict-dialog').open&&!$('close-dialog').open){event.preventDefault();closeFindbar();}});
  initialize();
})();
