// 配置加载状态
let configLoaded = false;

// 加载配置
let config = {
  websites: [],
  mappings: {}
};

// 深拷贝函数
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// 规范化域名
function normalizeDomain(domain) {
  return domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

// 检查当前网站是否在配置列表中
function isWebsiteEnabled() {
  if (!configLoaded) return false;
  
  const currentHostname = window.location.hostname.toLowerCase();
  return config.websites.some(website => {
    const normalizedWebsite = normalizeDomain(website);
    return currentHostname === normalizedWebsite || 
           currentHostname.endsWith('.' + normalizedWebsite);
  });
}

// 获取按键标识符
function getKeyIdentifier(event) {
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const modifierNames = {
    ctrlKey: isMac ? 'Control' : 'Ctrl',
    shiftKey: 'Shift',
    altKey: isMac ? 'Option' : 'Alt',
    metaKey: isMac ? 'Command' : 'Win'
  };

  let keyName = event.key;
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

// 存储事件监听器引用
let keydownListener = null;

// 初始化
async function initializeConfig() {
  try {
    const result = await chrome.storage.sync.get(['keyMapperConfig']);
    if (result.keyMapperConfig) {
      config = deepClone(result.keyMapperConfig);
      configLoaded = true;
      console.log('配置加载成功，当前配置:', config);
    } else {
      console.log('未找到已保存的配置，使用默认配置:', config);
    }
    
    // 添加事件监听器
    if (!keydownListener) {
      keydownListener = handleKeyDown;
      document.addEventListener('keydown', keydownListener, true);
    }
  } catch (e) {
    console.error('配置加载失败，具体错误:', {
      message: e.message,
      stack: e.stack,
      config: config
    });
    configLoaded = false;
  }
}

// 清理函数
function cleanup() {
  if (keydownListener) {
    document.removeEventListener('keydown', keydownListener, true);
    keydownListener = null;
  }
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
  }
}

// 页面卸载时清理
window.addEventListener('unload', cleanup);

let retryInterval = null;

function startRetryMechanism() {
  if (retryInterval) clearInterval(retryInterval);
  
  retryInterval = setInterval(() => {
    if (!configLoaded) {
      console.log('尝试重新加载配置...');
      initializeConfig().catch(e => {
        console.error('重试失败:', e);
      });
    } else {
      clearInterval(retryInterval);
      retryInterval = null;
    }
  }, 5000);
}

// 键盘事件处理函数
function handleKeyDown(event) {
  if (!configLoaded || !isWebsiteEnabled()) return;

  const pressedKey = getKeyIdentifier(event);
  const mapping = config.mappings[pressedKey];
  
  if (mapping) {
    event.preventDefault();
    event.stopImmediatePropagation();

    if (Array.isArray(mapping)) {
      executeKeySequence(mapping).catch(console.error);
    } else {
      executeKeyMapping(mapping);
    }

    return false;
  }
}

// 创建键盘事件
function createKeyboardEvent(type, keyInfo) {
  return new KeyboardEvent(type, {
    key: keyInfo.key,
    code: keyInfo.code,
    keyCode: keyInfo.keyCode,
    which: keyInfo.which,
    ctrlKey: keyInfo.ctrlKey,
    shiftKey: keyInfo.shiftKey,
    altKey: keyInfo.altKey,
    metaKey: keyInfo.metaKey,
    bubbles: true,
    cancelable: true,
    composed: true,
    isTrusted: false
  });
}

// 执行单个按键映射
async function executeKeyMapping(mapping) {
  const events = [
    createKeyboardEvent('keydown', mapping),
    createKeyboardEvent('keypress', mapping),
    createKeyboardEvent('keyup', mapping)
  ];

  for (const event of events) {
    document.dispatchEvent(event);
    if (document.activeElement) {
      document.activeElement.dispatchEvent(event);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

// 执行按键序列
async function executeKeySequence(sequence) {
  for (const step of sequence) {
    await executeKeyMapping(step);
    await new Promise(resolve => setTimeout(resolve, step.delay || 50));
  }
}

// 监听配置变化
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.keyMapperConfig) {
    try {
      config = changes.keyMapperConfig.newValue || { websites: [], mappings: {} };
      configLoaded = true;
    } catch (e) {
      console.error('配置更新失败:', e);
      configLoaded = false;
    }
  }
});

// 初始化
initializeConfig().catch(e => {
  console.error('初始化失败:', e);
  configLoaded = false;
  startRetryMechanism();
}); 