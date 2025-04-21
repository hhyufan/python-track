// 导入electron-store模块
import Store from 'electron-store'
import { app } from 'electron'
// 创建Store实例用于持久化存储
const store = new Store({
  name: 'user-state', // 存储文件名
  // 确保存储在用户数据目录下
  cwd: app.getPath('userData'),
  // 定义存储结构的默认值
  defaults: {
    // 当前选中的教程
    currentTutorial: '基础知识',
    // 各教程的学习状态
    tutorialStates: {},
    // 已完成的练习
    completedExercises: [],
    // 主题设置
    theme: 'light',
    // 演练场代码编辑内容
    codeEditorContents: {}
  }
})

/**
 * 获取当前选中的教程
 * @returns {string} 当前教程的key
 */
function getCurrentTutorial() {
  return store.get('currentTutorial')
}

/**
 * 设置当前选中的教程
 * @param {string} tutorialKey 教程的key
 */
function setCurrentTutorial(tutorialKey) {
  store.set('currentTutorial', tutorialKey)
}

/**
 * 获取教程状态
 * @param {string} tutorialKey 教程的key
 * @returns {Object} 教程状态对象，包含章节、子章节和代码块的索引
 */
function getTutorialState(tutorialKey) {
  const states = store.get('tutorialStates')
  return (
    states[tutorialKey] || {
      currentSectionIndex: 0, // 当前章节索引
      currentSubSectionIndex: 0, // 当前子章节索引
      currentCodeBlockIndex: 0, // 当前代码块索引（全局）
      sectionCodeBlockIndex: 0, // 当前章节内的代码块索引
      subSectionCodeBlockIndex: 0, // 当前子章节内的代码块索引
      lastUpdated: Date.now() // 最后更新时间
    }
  )
}

/**
 * 设置教程状态
 * @param {string} tutorialKey 教程的key
 * @param {Object} state 状态对象，可包含章节、子章节和代码块的索引
 */
function setTutorialState(tutorialKey, state) {
  const states = store.get('tutorialStates')
  // 获取现有状态或创建默认状态
  const currentState = states[tutorialKey] || {
    currentSectionIndex: 0,
    currentSubSectionIndex: 0,
    currentCodeBlockIndex: 0,
    sectionCodeBlockIndex: 0,
    subSectionCodeBlockIndex: 0,
    lastUpdated: Date.now()
  }

  // 合并新状态，保留未提供的字段
  states[tutorialKey] = {
    ...currentState,
    ...state,
    lastUpdated: Date.now() // 更新时间戳
  }

  store.set('tutorialStates', states)
}

/**
 * 获取已完成的练习列表
 * @returns {Array} 已完成的练习ID列表
 */
function getCompletedExercises() {
  return store.get('completedExercises')
}

/**
 * 添加已完成的练习
 * @param {string} exerciseId 练习ID
 */
function addCompletedExercise(exerciseId) {
  const completed = store.get('completedExercises')
  if (!completed.includes(exerciseId)) {
    completed.push(exerciseId)
    store.set('completedExercises', completed)
  }
}

/**
 * 获取主题设置
 * @returns {string} 主题名称 ('light' 或 'dark')
 */
function getTheme() {
  return store.get('theme')
}

/**
 * 设置主题
 * @param {string} theme 主题名称 ('light' 或 'dark')
 */
function setTheme(theme) {
  store.set('theme', theme)
}

/**
 * 获取代码编辑内容
 * @param {string} tutorialKey 教程的key
 * @param {number} sectionIndex 章节索引
 * @param {number} blockIndex 代码块索引
 * @returns {string} 保存的代码内容
 */
function getCodeEditorContent(tutorialKey, sectionIndex, blockIndex) {
  const codeEditorContents = store.get('codeEditorContents')
  const key = `${tutorialKey}-${sectionIndex}-${blockIndex}`
  return codeEditorContents[key] || ''
}

/**
 * 设置代码编辑内容
 * @param {string} tutorialKey 教程的key
 * @param {number} sectionIndex 章节索引
 * @param {number} blockIndex 代码块索引
 * @param {string} content 代码内容
 */
function setCodeEditorContent(tutorialKey, sectionIndex, blockIndex, content) {
  const codeEditorContents = store.get('codeEditorContents')
  const key = `${tutorialKey}-${sectionIndex}-${blockIndex}`
  codeEditorContents[key] = content
  store.set('codeEditorContents', codeEditorContents)
}

/**
 * 获取通用状态
 * @param {string} key 状态键名
 * @returns {any} 存储的状态值
 */
function getState(key) {
  return store.get(key, null)
}

/**
 * 设置通用状态
 * @param {string} key 状态键名
 * @param {any} value 要存储的状态值
 * @returns {boolean} 操作是否成功
 */
function setState(key, value) {
  try {
    store.set(key, value)
    return true
  } catch (error) {
    console.error(`设置状态[${key}]失败:`, error)
    return false
  }
}

export default {
  getCurrentTutorial,
  setCurrentTutorial,
  getTutorialState,
  setTutorialState,
  getCompletedExercises,
  addCompletedExercise,
  getTheme,
  setTheme,
  getCodeEditorContent,
  setCodeEditorContent,
  getState,
  setState
}
