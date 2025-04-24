// Monaco编辑器配置文件
import oneLightTheme from './monaco-one-light-theme'
import oneDarkTheme from './monaco-one-dark-theme'
import initPythonLanguage from './monaco-python-language'
import { codeBlockManager } from './code-block-manager'

const monaco = {
  init: () => {
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js'
    script.onload = () => {
      window.require.config({
        paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs' },
        'vs/nls': { availableLanguages: { '*': 'zh-cn' } }
      })

      // 将codeBlockManager挂载到window对象上，使其全局可用
      window.codeBlockManager = codeBlockManager

      // 加载Monaco编辑器
      window.require(['vs/editor/editor.main'], () => {
        // 注册自定义主题
        window.monaco.editor.defineTheme('one-light', oneLightTheme)
        window.monaco.editor.defineTheme('one-dark', oneDarkTheme)
        // 初始化Python语言定义，包括自定义语法高亮规则
        initPythonLanguage()

        // 设置编辑器默认选项，添加自适应宽度配置
        window.monaco.editor.EditorOptions.wordWrap.defaultValue = 'on' // 启用自动换行

        // 添加窗口大小变化的监听事件，用于自适应调整编辑器宽度
        window.addEventListener('resize', monaco.adjustEditorWidth)

        // 重写editor.create方法，添加自适应宽度的默认配置
        const originalCreate = window.monaco.editor.create
        window.monaco.editor.create = (element, options, ...args) => {
          // 合并默认选项
          const defaultOptions = {
            automaticLayout: true, // 自动调整布局
            wordWrap: 'on', // 启用自动换行
            minimap: { enabled: false }, // 禁用小地图以节省空间
            scrollBeyondLastLine: false, // 禁止滚动超过最后一行
            lineNumbers: 'on', // 显示行号
            renderLineHighlight: 'all', // 高亮当前行
            fontFamily: 'Source Code Pro, Consolas, Monaco, monospace', // 设置字体
            fontSize: 14 // 设置字体大小
          }

          const mergedOptions = { ...defaultOptions, ...options }
          const editor = originalCreate(element, mergedOptions, ...args)

          // 确保编辑器容器宽度设置为100%
          if (element) {
            element.style.width = '100%'
            if (element.parentElement) {
              element.parentElement.style.width = '100%'
              // 确保父容器不限制高度
              element.parentElement.style.height = 'auto'
              element.parentElement.style.overflow = 'visible'
            }
          }

          // 添加内容变化监听器，动态调整编辑器高度
          monaco.updateEditorHeight(editor)

          // 监听内容变化事件
          editor.onDidChangeModelContent(() => {
            monaco.updateEditorHeight(editor)
          })

          // 监听模型加载完成事件
          editor.onDidChangeModel(() => {
            monaco.updateEditorHeight(editor)
          })

          // 监听配置变化事件
          editor.onDidChangeConfiguration(() => {
            monaco.updateEditorHeight(editor)
          })

          return editor
        }
      })
    }
    document.body.appendChild(script)
  },

  // 获取当前主题名称
  getThemeName: (isDark) => {
    return isDark ? 'one-dark' : 'one-light'
  },

  // 调整编辑器宽度以适应容器
  adjustEditorWidth: () => {
    // 获取所有Monaco编辑器实例
    if (window.monaco && window.monaco.editor) {
      const editors = window.monaco.editor.getEditors()

      // 遍历所有编辑器实例并调整其布局
      editors.forEach((editor) => {
        if (editor) {
          // 自动调整编辑器布局以适应其容器
          editor.layout()

          // 确保编辑器容器宽度设置为100%
          const editorElement = editor.getDomNode()
          if (editorElement && editorElement.parentElement) {
            editorElement.style.width = '100%'
            editorElement.parentElement.style.width = '100%'
          }

          // 更新编辑器高度
          monaco.updateEditorHeight(editor)
        }
      })
    }
  },

  // 更新编辑器高度以适应代码行数，最大显示25行，超出部分显示竖向滚动条
  updateEditorHeight: (editor) => {
    if (!editor) return

    // 获取编辑器的行数
    const lineCount = editor.getModel()?.getLineCount() || 1

    // 获取行高
    const lineHeight = editor.getOption(window.monaco.editor.EditorOption.lineHeight)

    // 最大显示25行代码
    const maxVisibleLines = 25

    // 计算编辑器内容的高度
    // 如果行数超过25行，则固定高度为25行高度，否则自适应高度
    const contentHeight = Math.min(lineCount, maxVisibleLines) * lineHeight

    // 获取编辑器DOM元素
    const editorElement = editor.getDomNode()
    if (editorElement) {
      // 设置编辑器容器的高度
      editorElement.style.height = `${contentHeight}px`

      // 设置父容器样式
      if (editorElement.parentElement) {
        // 设置父容器高度和滚动条
        editorElement.parentElement.style.height = `${contentHeight}px`
        editorElement.parentElement.style.minHeight = `${contentHeight}px`

        // 当行数超过25行时，启用滚动条，否则保持可见
        editorElement.parentElement.style.overflow =
          lineCount > maxVisibleLines ? 'auto' : 'visible'

        // 查找并更新外层.code-editor-container容器
        let containerElement = editorElement.parentElement
        while (containerElement && !containerElement.classList.contains('code-editor-container')) {
          containerElement = containerElement.parentElement
        }

        // 如果找到了外层容器，更新其高度和滚动条设置
        if (containerElement) {
          containerElement.style.height = `${contentHeight}px`
          containerElement.style.minHeight = `${contentHeight}px`
          containerElement.style.overflow = lineCount > maxVisibleLines ? 'auto' : 'visible'
        }
      }

      // 通知编辑器布局已更改
      setTimeout(() => {
        editor.layout()
      }, 0)
    }
  }
}

// 初始化Monaco编辑器
monaco.init()

// 导出加载器
export { monaco }
