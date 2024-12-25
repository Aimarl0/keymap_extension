// 存储当前的配置
let currentConfig = {
  websites: [],
  mappings: {}
};

// 当前正在捕获的元素
let capturingElement = null;

// 危险的快捷键组合
const DANGEROUS_SHORTCUTS = [
  // Windows/Linux 危险快捷键
  'Ctrl+W', 'Ctrl+Q', 'Alt+F4',
  // macOS 危险快捷键
  'Command+W', 'Command+Q', 'Command+M', 'Command+H',
  // 通用危险快捷键
  'F5', 'F11'
];

// 存储事件监听器引用以便清理
const eventListeners = new Map();

// 消息队列管理
const messageQueue = {
  messages: [],
  showing: false,
  maxMessages: 5,  // 限制最大消息数

  add(message, type = 'info') {
    // 如果队列已满，移除最早的消息
    if (this.messages.length >= this.maxMessages) {
      this.messages.shift();
    }
    
    this.messages.push({ message, type });
    if (!this.showing) {
      this.showNext();
    }
  },

  showNext() {
    if (this.messages.length === 0) {
      this.showing = false;
      return;
    }

    this.showing = true;
    const { message, type } = this.messages.shift();
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = message;
    
    // 计算位置，避免重叠
    const existingMessages = document.querySelectorAll('.message');
    const offset = existingMessages.length * 60;
    messageDiv.style.top = `${20 + offset}px`;
    
    // 添加淡入淡出效果
    messageDiv.style.opacity = '0';
    document.body.appendChild(messageDiv);
    
    // 淡入
    setTimeout(() => {
      messageDiv.style.opacity = '1';
    }, 10);
    
    // 淡出并移除
    setTimeout(() => {
      messageDiv.style.opacity = '0';
      setTimeout(() => {
        messageDiv.remove();
        this.showNext();
      }, 300);
    }, 2700);  // 3000 - 300 = 2700，确保总时间仍为3秒
  }
};

// 错误类型定义
const ErrorTypes = {
  INVALID_CONFIG: 'INVALID_CONFIG',
  INVALID_WEBSITE: 'INVALID_WEBSITE',
  DUPLICATE_WEBSITE: 'DUPLICATE_WEBSITE',
  STORAGE_ERROR: 'STORAGE_ERROR',
  INVALID_MAPPING: 'INVALID_MAPPING',
  DUPLICATE_MAPPING: 'DUPLICATE_MAPPING',
  INVALID_KEY_INFO: 'INVALID_KEY_INFO',
  BACKUP_ERROR: 'BACKUP_ERROR',
  RESTORE_ERROR: 'RESTORE_ERROR'
};

// 自定义错误类
class AppError extends Error {
  constructor(type, message) {
    super(message);
    this.type = type;
  }
}

// 错误处理函数
function handleError(error, context) {
  const errorMessages = {
    [ErrorTypes.INVALID_WEBSITE]: '无效的网站地址',
    [ErrorTypes.DUPLICATE_WEBSITE]: '该网站已存在',
    [ErrorTypes.STORAGE_ERROR]: '存储操作失败',
    [ErrorTypes.INVALID_MAPPING]: '无效的按键映射',
    [ErrorTypes.DUPLICATE_MAPPING]: '该映射已存在'
  };

  const message = error instanceof AppError
    ? errorMessages[error.type] || error.message
    : `${context}: ${error.message}`;

  showMessage(message, 'error');
  console.error(context, error);
}

// 配置修改跟踪
let configModified = false;

// 定时器管理
const timers = {
  autoSave: null,
  backup: null,
  
  clearAll() {
    if (this.autoSave) {
      clearTimeout(this.autoSave);
      this.autoSave = null;
    }
    if (this.backup) {
      clearInterval(this.backup);
      this.backup = null;
    }
  }
};

// 修改自动保存机制
function markConfigModified() {
  configModified = true;
  if (timers.autoSave) clearTimeout(timers.autoSave);
  timers.autoSave = setTimeout(async () => {
    await autoSave();
    // 成功保存后再进行备份
    backupConfig();
  }, 3000);
}

// 启动定期备份
function startBackupTimer() {
  if (timers.backup) clearInterval(timers.backup);
  timers.backup = setInterval(backupConfig, 60000);
}

// 在页面加载时启动备份定时器
document.addEventListener('DOMContentLoaded', () => {
  startBackupTimer();
});

// 在页面卸载时清理所有定时器
window.addEventListener('unload', () => {
  timers.clearAll();
  cleanupEventListeners();
});

// 自动保存函数
async function autoSave() {
  if (!configModified) return;
  
  try {
    const configToSave = JSON.parse(JSON.stringify(currentConfig));
    validateConfig(configToSave);
    
    await chrome.storage.sync.set({ keyMapperConfig: configToSave });
    configModified = false;  // 自动保存成功后重置修改标记
    showMessage('配置已自动保存', 'success');
  } catch (e) {
    handleError(e, '自动保存失败');
  }
}

// 配置操作锁
const configLock = {
  locked: false,
  queue: [],
  
  async acquire() {
    if (this.locked) {
      await new Promise(resolve => this.queue.push(resolve));
    }
    this.locked = true;
  },
  
  release() {
    this.locked = false;
    const next = this.queue.shift();
    if (next) next();
  },
  
  async withLock(operation) {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }
};

// 初始化页面
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 注入样式
    const style = document.createElement('style');
    style.textContent = `
      .message {
        position: fixed;
        right: 20px;
        padding: 10px 20px;
        border-radius: 4px;
        color: white;
        z-index: 1000;
        transition: opacity 0.3s ease;
        -webkit-transition: opacity 0.3s ease;
        -moz-transition: opacity 0.3s ease;
        -o-transition: opacity 0.3s ease;
        pointer-events: none;
      }
      .message + .message {
        margin-top: 10px;
      }
      .message.success { background-color: #4caf50; z-index: 1001; }
      .message.error { background-color: #f44336; z-index: 1002; }
      .message.warning { background-color: #ff9800; z-index: 1003; }
      .message.info { background-color: #2196f3; z-index: 1004; }
    `;
    document.head.appendChild(style);

    // 加载配置
    const saved = await chrome.storage.sync.get(['keyMapperConfig']);
    if (saved.keyMapperConfig) {
      currentConfig = deepClone(saved.keyMapperConfig);
    }
    
    // 渲染配置
    renderWebsites();
    renderMappings();
    
    // 设置事件监听器
    setupEventListeners();

    if (!checkConfigConsistency()) {
      await recoverFromError();
    }
  } catch (e) {
    showMessage('配置加载失败，尝试恢复...', 'warning');
    if (!await recoverFromError()) {
      showMessage('无法恢复配置，请刷新页面重试', 'error');
    }
  }
});

// 设置事件监听器
function setupEventListeners() {
  const addListener = (id, event, handler) => {
    const element = document.getElementById(id);
    if (!element) {
      console.warn(`Element with id ${id} not found`);
      return;
    }
    element.addEventListener(event, handler);
    eventListeners.set(`${id}-${event}`, { element, event, handler });
  };

  // 现有的监听器
  addListener('add-website', 'click', addWebsite);
  addListener('source-key', 'click', () => startCapturing(document.getElementById('source-key'), 'source'));
  addListener('target-key', 'click', () => startCapturing(document.getElementById('target-key'), 'target'));
  addListener('add-mapping', 'click', addMapping);
  addListener('save-settings', 'click', saveSettings);

  // 序列相关的监听器
  addListener('single-key-mode', 'click', () => switchMode('single'));
  addListener('sequence-mode', 'click', () => switchMode('sequence'));
  addListener('sequence-source-key', 'click', () => startCapturing(document.getElementById('sequence-source-key'), 'sequence-source'));
  addListener('sequence-target-key', 'click', () => startCapturing(document.getElementById('sequence-target-key'), 'sequence-target'));
  addListener('add-sequence-step', 'click', addSequenceStep);
  addListener('clear-sequence', 'click', clearSequence);
  addListener('add-sequence-mapping', 'click', addSequenceMapping);
}

// 清理所有事件监听器
function cleanupEventListeners() {
  eventListeners.forEach(({ element, event, handler }) => {
    element.removeEventListener(event, handler);
  });
  eventListeners.clear();

  if (capturingElement) {
    document.removeEventListener('keydown', captureKey);
  }
}

// 开始捕获按键
function startCapturing(element, type) {
  if (capturingElement) {
    capturingElement.textContent = type === 'source' ? 
      '点击此处捕获源按键' : '点击此处捕获目标按键';
    capturingElement.classList.remove('capturing');
  }
  
  capturingElement = element;
  element.textContent = '请按下键...';
  element.classList.add('capturing');
  
  // 添加一次性按键监听器
  document.addEventListener('keydown', captureKey);
}

// 获取按键标识符
function getKeyIdentifier(event, keyName) {
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const modifierNames = {
    ctrlKey: isMac ? 'Control' : 'Ctrl',
    shiftKey: 'Shift',
    altKey: isMac ? 'Option' : 'Alt',
    metaKey: isMac ? 'Command' : 'Win'
  };

  if (keyName.startsWith('F') && !isNaN(keyName.slice(1))) {
    // 功能键保持原样
    keyName = keyName;
  } else if (keyName.length === 1) {
    // 单个字符转换为大写
    keyName = keyName.toUpperCase();
  }

  const modifiers = [
    event.ctrlKey ? modifierNames.ctrlKey : '',
    event.shiftKey ? modifierNames.shiftKey : '',
    event.altKey ? modifierNames.altKey : '',
    event.metaKey ? modifierNames.metaKey : ''
  ].filter(Boolean);

  return [...modifiers, keyName].join('+');
}

// 捕获按键
function captureKey(event) {
  event.preventDefault();
  event.stopPropagation();
  
  if (!capturingElement) return;
  
  if (['Control', 'Alt', 'Shift', 'Meta', 'Command'].includes(event.key)) {
    return;
  }
  
  const keyInfo = {
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    which: event.which,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey
  };
  
  const keyText = getKeyIdentifier(event, event.key);
  
  if (DANGEROUS_SHORTCUTS.includes(keyText)) {
    showMessage('该快捷键组合可能影响浏览器正常使用，请选择其他组合', 'warning');
    return;
  }
  
  capturingElement.textContent = keyText;
  capturingElement.dataset.keyInfo = JSON.stringify(keyInfo);
  
  document.removeEventListener('keydown', captureKey);
  capturingElement.classList.remove('capturing');
  capturingElement = null;
}

// 安全的 HTML 转义函数
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 改网站格式处理
function normalizeWebsite(website) {
  try {
    const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    return url.hostname.toLowerCase();
  } catch (e) {
    throw new Error('无效的网站地址');
  }
}

// 修改网站添加函数
async function addWebsite() {
  return configLock.withLock(async () => {
    const input = document.getElementById('website-input');
    const website = input.value.trim();
    
    try {
      if (!website) {
        throw new AppError(ErrorTypes.INVALID_WEBSITE, '请输入网站地址');
      }
      
      const normalizedWebsite = normalizeWebsite(website);
      if (currentConfig.websites.includes(normalizedWebsite)) {
        throw new AppError(ErrorTypes.DUPLICATE_WEBSITE);
      }

      currentConfig.websites.push(normalizedWebsite);
      renderWebsites();
      input.value = '';
      showMessage('网站添加成功', 'success');
      markConfigModified();
    } catch (e) {
      handleError(e, '添加网站失败');
    }
  });
}

// 添加消息提示功能
function showMessage(message, type = 'info') {
  messageQueue.add(message, type);
}

// 添加 deepClone 函数
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// 添加映射
function addMapping() {
  const sourceElement = document.getElementById('source-key');
  const targetElement = document.getElementById('target-key');
  
  try {
    const sourceKey = sourceElement.dataset.keyInfo;
    const targetKey = targetElement.dataset.keyInfo;
    
    if (!sourceKey || !targetKey) {
      showMessage('请先捕获源按键和目标按键', 'warning');
      return;
    }
    
    const sourceKeyInfo = JSON.parse(sourceKey);
    const sourceKeyText = getKeyIdentifier({
      ctrlKey: sourceKeyInfo.ctrlKey,
      shiftKey: sourceKeyInfo.shiftKey,
      altKey: sourceKeyInfo.altKey,
      metaKey: sourceKeyInfo.metaKey
    }, sourceKeyInfo.key);
    
    const targetKeyObj = JSON.parse(targetKey);
    
    if (currentConfig.mappings[sourceKeyText]) {
      showMessage('该按键映射已存在，将覆盖原有映射', 'warning');
    }
    
    currentConfig.mappings[sourceKeyText] = targetKeyObj;
    renderMappings();
    
    // 重置输入
    sourceElement.textContent = '点击此处捕获源按键';
    targetElement.textContent = '点击此处捕获目标按键';
    delete sourceElement.dataset.keyInfo;
    delete targetElement.dataset.keyInfo;
    
    showMessage('按键映射添加成功', 'success');
    markConfigModified();
  } catch (e) {
    showMessage('添加映射失败：' + e.message, 'error');
  }
}

// 安全的文本处理函数
function sanitizeText(text) {
  if (typeof text !== 'string') {
    return '';
  }
  return text.replace(/[<>&"']/g, char => {
    const entities = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return entities[char];
  });
}

// 渲染网站列表
function renderWebsites() {
  const container = document.getElementById('website-list');
  container.textContent = ''; // 使用 textContent 清空
  
  currentConfig.websites.forEach(website => {
    const div = document.createElement('div');
    div.className = 'mapping-item';
    
    const span = document.createElement('span');
    span.textContent = sanitizeText(website);
    div.appendChild(span);
    
    const button = document.createElement('button');
    button.textContent = '删除';
    button.addEventListener('click', () => removeWebsite(sanitizeText(website)));
    div.appendChild(button);
    
    container.appendChild(div);
  });
}

// 渲染映射列表
function renderMappings() {
  const container = document.getElementById('mapping-list');
  container.innerHTML = '';

  Object.entries(currentConfig.mappings).forEach(([source, target]) => {
    const div = document.createElement('div');
    div.className = 'mapping-item';
    
    const span = document.createElement('span');
    if (Array.isArray(target)) {
      const sequence = target.map((step, index) => {
        const keyText = getKeyIdentifier({
          ctrlKey: step.ctrlKey,
          shiftKey: step.shiftKey,
          altKey: step.altKey,
          metaKey: step.metaKey
        }, step.key);
        return `${index + 1}. ${keyText}`;
      }).join(' → ');
      span.textContent = `${sanitizeText(source)} -> [${sequence}]`;
    } else {
      const keyText = getKeyIdentifier({
        ctrlKey: target.ctrlKey,
        shiftKey: target.shiftKey,
        altKey: target.altKey,
        metaKey: target.metaKey
      }, target.key);
      span.textContent = `${sanitizeText(source)} -> ${keyText}`;
    }
    div.appendChild(span);
    
    const button = document.createElement('button');
    button.textContent = '删除';
    button.addEventListener('click', () => removeMapping(source));
    div.appendChild(button);
    
    container.appendChild(div);
  });
}

// 删除网站
function removeWebsite(website) {
  try {
    currentConfig.websites = currentConfig.websites.filter(w => w !== website);
    renderWebsites();
    showMessage('网站删除成功', 'success');
    markConfigModified();
  } catch (e) {
    showMessage('删除网站失败：' + e.message, 'error');
  }
}

// 删除映射
function removeMapping(source) {
  try {
    delete currentConfig.mappings[source];
    renderMappings();
    showMessage('映射删除成功', 'success');
    markConfigModified();
  } catch (e) {
    showMessage('删除映射失败：' + e.message, 'error');
  }
}

// 配置验证函数
function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new AppError(ErrorTypes.INVALID_CONFIG, '无效的配置对象');
  }

  if (!Array.isArray(config.websites)) {
    throw new AppError(ErrorTypes.INVALID_CONFIG, '无效的网站列表');
  }

  if (typeof config.mappings !== 'object') {
    throw new AppError(ErrorTypes.INVALID_CONFIG, '无效的映射配置');
  }

  // 验证每个网站
  config.websites.forEach(website => {
    if (typeof website !== 'string' || !website.trim()) {
      throw new AppError(ErrorTypes.INVALID_WEBSITE, `无效的网站: ${website}`);
    }
    try {
      normalizeWebsite(website);
    } catch (e) {
      throw new AppError(ErrorTypes.INVALID_WEBSITE, `无效的网站格式: ${website}`);
    }
  });

  // 验证每个映射
  Object.entries(config.mappings).forEach(([source, target]) => {
    if (!source || typeof source !== 'string') {
      throw new AppError(ErrorTypes.INVALID_MAPPING, '无效的源按键');
    }
    
    // 检查目标是否为序列
    if (Array.isArray(target)) {
      // 验证序列中的每个步骤
      target.forEach((step, index) => {
        if (!step || typeof step !== 'object') {
          throw new AppError(ErrorTypes.INVALID_MAPPING, `序列中的第${index + 1}步无效`);
        }

        // 验证必要的属性
        const requiredProps = ['key', 'code', 'keyCode', 'which'];
        requiredProps.forEach(prop => {
          if (!(prop in step)) {
            throw new AppError(ErrorTypes.INVALID_KEY_INFO, `序列中的第${index + 1}步缺少必要的按键属性: ${prop}`);
          }
        });

        // 验证布尔属性
        ['ctrlKey', 'shiftKey', 'altKey'].forEach(prop => {
          if (prop in step && typeof step[prop] !== 'boolean') {
            throw new AppError(ErrorTypes.INVALID_KEY_INFO, `序列中的第${index + 1}步的修饰键状态无效: ${prop}`);
          }
        });

        // 验证延迟时间（如果存在）
        if ('delay' in step && (typeof step.delay !== 'number' || step.delay < 0)) {
          throw new AppError(ErrorTypes.INVALID_KEY_INFO, `序列中的第${index + 1}步的延迟时间无效`);
        }
      });
    } else {
      // 如果不是序列，按原有逻辑验证单个映射
      if (!target || typeof target !== 'object') {
        throw new AppError(ErrorTypes.INVALID_MAPPING, '无效的目标按键');
      }

      // 验证必要的属性
      const requiredProps = ['key', 'code', 'keyCode', 'which'];
      requiredProps.forEach(prop => {
        if (!(prop in target)) {
          throw new AppError(ErrorTypes.INVALID_KEY_INFO, `缺少必要的按键属性: ${prop}`);
        }
      });

      // 验证布尔属性
      ['ctrlKey', 'shiftKey', 'altKey'].forEach(prop => {
        if (prop in target && typeof target[prop] !== 'boolean') {
          throw new AppError(ErrorTypes.INVALID_KEY_INFO, `无效的修饰键状态: ${prop}`);
        }
      });
    }
  });

  return true;
}

// 保存设置
async function saveSettings() {
  try {
    const configToSave = JSON.parse(JSON.stringify(currentConfig));
    validateConfig(configToSave);
    
    await chrome.storage.sync.set({ keyMapperConfig: configToSave });
    showMessage('设置已保存', 'success');
    configModified = false;  // 保存成功后重置修改标记
  } catch (e) {
    handleError(e, '保存设置失败');
  }
}

// 修改页面卸载处理
window.addEventListener('unload', cleanupEventListeners);

// 页面关闭前检查是否需要保存
window.addEventListener('beforeunload', (event) => {
  if (configModified) {
    event.preventDefault();
    event.returnValue = '有未保存的更改，确定要离开吗？';
  }
});

// 配置备份
function backupConfig() {
  try {
    const backup = JSON.stringify(currentConfig);
    localStorage.setItem('keyMapperConfigBackup', backup);
  } catch (e) {
    console.error('配置备份失败:', e);
  }
}

// 恢复配置
async function restoreConfig() {
  try {
    const backup = localStorage.getItem('keyMapperConfigBackup');
    if (backup) {
      const config = JSON.parse(backup);
      validateConfig(config);
      currentConfig = config;
      await saveSettings();
      showMessage('配置已从备份恢复', 'success');
    }
  } catch (e) {
    handleError(e, '配置恢复失败');
  }
}

// 添加配置恢复机制
async function recoverFromError() {
  try {
    // 尝试从备份恢复
    const backup = localStorage.getItem('keyMapperConfigBackup');
    if (backup) {
      const config = JSON.parse(backup);
      validateConfig(config);
      currentConfig = config;
      await saveSettings();
      showMessage('已从备份恢复配置', 'success');
      return true;
    }
    
    // 如果没有备份，重置为默认配置
    currentConfig = {
      websites: [],
      mappings: {}
    };
    await saveSettings();
    showMessage('已重置为默认配置', 'warning');
    return true;
  } catch (e) {
    handleError(e, '配置恢复失败');
    return false;
  }
}

// 添加配置一致性检查
function checkConfigConsistency() {
  try {
    // 检查网站列表中的重复项
    const uniqueWebsites = new Set(currentConfig.websites);
    if (uniqueWebsites.size !== currentConfig.websites.length) {
      currentConfig.websites = [...uniqueWebsites];
      markConfigModified();
      showMessage('已移除重复的网站配置', 'warning');
    }

    // 检查映射的有效性
    Object.entries(currentConfig.mappings).forEach(([source, target]) => {
      if (!source || !target || typeof target !== 'object') {
        delete currentConfig.mappings[source];
        markConfigModified();
        showMessage(`已移除无效的映射: ${source}`, 'warning');
      }
    });

    return true;
  } catch (e) {
    handleError(e, '配置一致性检查失败');
    return false;
  }
}

// 当前序列步骤
let currentSequence = [];

// 切换模式
function switchMode(mode) {
  const singleKeySection = document.getElementById('single-key-section');
  const sequenceSection = document.getElementById('sequence-section');
  const singleKeyButton = document.getElementById('single-key-mode');
  const sequenceButton = document.getElementById('sequence-mode');

  if (mode === 'single') {
    singleKeySection.classList.remove('hidden');
    sequenceSection.classList.add('hidden');
    singleKeyButton.classList.add('active');
    sequenceButton.classList.remove('active');
  } else {
    singleKeySection.classList.add('hidden');
    sequenceSection.classList.remove('hidden');
    singleKeyButton.classList.remove('active');
    sequenceButton.classList.add('active');
  }
}

// 添加序列步骤
function addSequenceStep() {
  const targetElement = document.getElementById('sequence-target-key');
  const delayInput = document.getElementById('step-delay');
  
  const targetKey = targetElement.dataset.keyInfo;
  if (!targetKey) {
    showMessage('请先捕获按键', 'warning');
    return;
  }

  const delay = parseInt(delayInput.value) || 50;
  const keyInfo = JSON.parse(targetKey);
  keyInfo.delay = delay;

  currentSequence.push(keyInfo);
  renderSequence();
  
  // 重置输入
  targetElement.textContent = '点击此处捕获序列按键';
  delete targetElement.dataset.keyInfo;
  delayInput.value = '50';
}

// 渲染序列
function renderSequence() {
  const container = document.getElementById('sequence-list');
  container.innerHTML = '';
  
  currentSequence.forEach((step, index) => {
    const div = document.createElement('div');
    div.className = 'sequence-item';
    
    const keyText = getKeyIdentifier({
      ctrlKey: step.ctrlKey,
      shiftKey: step.shiftKey,
      altKey: step.altKey,
      metaKey: step.metaKey
    }, step.key);
    
    div.textContent = `${index + 1}. ${keyText} (延迟: ${step.delay}ms)`;
    
    const removeButton = document.createElement('button');
    removeButton.textContent = '删除';
    removeButton.onclick = () => removeSequenceStep(index);
    div.appendChild(removeButton);
    
    container.appendChild(div);
  });
}

// 移除序列步骤
function removeSequenceStep(index) {
  currentSequence.splice(index, 1);
  renderSequence();
}

// 清空序列
function clearSequence() {
  currentSequence = [];
  renderSequence();
}

// 添加序列映射
function addSequenceMapping() {
  const sourceElement = document.getElementById('sequence-source-key');
  
  try {
    const sourceKey = sourceElement.dataset.keyInfo;
    
    if (!sourceKey) {
      showMessage('请先捕获源按键', 'warning');
      return;
    }
    
    if (currentSequence.length === 0) {
      showMessage('请至少添加一个序列步骤', 'warning');
      return;
    }
    
    const sourceKeyInfo = JSON.parse(sourceKey);
    const sourceKeyText = getKeyIdentifier({
      ctrlKey: sourceKeyInfo.ctrlKey,
      shiftKey: sourceKeyInfo.shiftKey,
      altKey: sourceKeyInfo.altKey,
      metaKey: sourceKeyInfo.metaKey
    }, sourceKeyInfo.key);
    
    if (currentConfig.mappings[sourceKeyText]) {
      showMessage('该按键映射已存在，将覆盖原有映射', 'warning');
    }
    
    currentConfig.mappings[sourceKeyText] = [...currentSequence];
    renderMappings();
    
    // 重置输入
    sourceElement.textContent = '点击此处捕获源按键';
    delete sourceElement.dataset.keyInfo;
    clearSequence();
    
    showMessage('序列映射添加成功', 'success');
    markConfigModified();
  } catch (e) {
    showMessage('添加序列映射失败：' + e.message, 'error');
  }
} 