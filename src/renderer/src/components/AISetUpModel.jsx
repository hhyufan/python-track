import { useState, useEffect } from 'react'
import { Modal, Form, Input, Select, message, Alert } from 'antd'
import api from '../api/index'

// eslint-disable-next-line react/prop-types
const AISetupModal = ({ visible, onComplete, errorMessage = null }) => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(errorMessage)
  // 数据初始化
  useEffect(() => {
    ;(async () => {
      try {
        // 首先尝试从electron store获取设置
        if (window.ipcApi && window.ipcApi.getState) {
          try {
            const storeSettings = await window.ipcApi.getState('aiSettings')
            if (storeSettings) {
              form.setFieldsValue(storeSettings)
              return
            }
          } catch (storeError) {
            console.error('从electron store获取AI设置失败:', storeError)
            // 如果从electron store获取失败，继续尝试其他方式
          }
        }

        // 从localStorage中获取已保存的设置（作为备选方案）
        const savedSettings = localStorage.getItem('aiSettings')
        if (savedSettings) {
          const parsedSettings = JSON.parse(savedSettings)
          form.setFieldsValue(parsedSettings)

          // 如果从localStorage获取成功，同时保存到electron store
          if (window.ipcApi && window.ipcApi.setState) {
            try {
              await window.ipcApi.setState('aiSettings', parsedSettings)
            } catch (syncError) {
              console.error('同步AI设置到electron store失败:', syncError)
            }
          }
          return
        }

        // 如果没有本地保存的设置，尝试从API获取
        const response = await api.getModelKeys()
        if (response.data && response.data.model_key) {
          const { base_url, model, api_key } = response.data.model_key
          // 设置表单值
          const settings = {
            baseUrl: base_url !== 'your_base_url' ? base_url : '',
            model: model !== 'your_model_name' ? model : '',
            apiKey: api_key !== 'your_api_key' ? api_key : ''
          }
          form.setFieldsValue(settings)
        }
      } catch (error) {
        console.error('获取模型配置失败:', error)
        // 获取失败时不显示错误，让用户手动输入
      }
    })()
  }, [form, visible])
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)

      // 使用API保存到后端
      const response = await api.setModelKey(values.baseUrl, values.model, values.apiKey)
      if (response.data.model_key.success) {
        // 保存到electron store
        if (window.ipcApi && window.ipcApi.setState) {
          try {
            await window.ipcApi.setState('aiSettings', values)
          } catch (storeError) {
            console.error('保存AI设置到electron store失败:', storeError)
            // 如果保存到electron store失败，仍然继续保存到localStorage
          }
        }

        // 同时保存到localStorage作为备选方案
        localStorage.setItem('aiSettings', JSON.stringify(values))

        message.success('AI 设置保存成功！')
        form.resetFields()
        onComplete(values)
      } else {
        message.error(response.data.model_key.message || '配置失败，请重试')
      }
    } catch (error) {
      console.error('保存失败:', error)
      // 检查是否为401认证错误
      if (error.response && error.response.status === 401) {
        const errorMsg = '认证失败：API密钥无效，请重新输入有效的API密钥'
        setError(errorMsg)
        message.error(errorMsg)
      } else {
        setError('配置失败: ' + (error.message || '未知错误'))
        message.error('配置失败: ' + (error.message || '未知错误'))
      }
    } finally {
      setLoading(false)
    }
  }

  // 当接收到新的错误消息时更新状态
  useEffect(() => {
    if (errorMessage) {
      setError(errorMessage)
    }
  }, [errorMessage, form])

  return (
    <Modal
      title={error ? '重新配置 AI 设置' : '首次使用 AI 功能设置'}
      open={visible}
      onOk={handleSubmit}
      confirmLoading={loading}
      closable={false}
      maskClosable={false}
      keyboard={false}
      okText="确认"
      footer={(_, { OkBtn }) => (
        <>
          <OkBtn />
        </>
      )}
    >
      {error && (
        <Alert
          message="认证错误"
          description={error}
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      <Form form={form} layout="vertical">
        <Form.Item
          name="baseUrl"
          label="AI 域名"
          rules={[{ required: true, message: '请输入 AI 域名' }]}
        >
          <Select
            showSearch
            placeholder="https://api.deepseek.com"
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            options={[
              { value: 'https://api.deepseek.com', label: 'https://api.deepseek.com' },
              { value: 'https://api.openai.com', label: 'https://api.openai.com' },
              { value: 'https://api.chatanywhere.tech', label: 'https://api.chatanywhere.tech' }
            ]}
          />
        </Form.Item>
        <Form.Item
          name="model"
          label="AI 模型"
          rules={[{ required: true, message: '请选择 AI 模型' }]}
        >
          <Select
            showSearch
            placeholder="deepseek V3"
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
          >
            <Select.Option value="deepseek-chat">deepseek V3</Select.Option>
            <Select.Option value="gpt-3.5-turbo">GPT-3.5 Turbo</Select.Option>
            <Select.Option value="gpt-4">GPT-4</Select.Option>
          </Select>
        </Form.Item>

        <Form.Item
          name="apiKey"
          label="API 密钥"
          rules={[
            { required: true, message: '请输入 API 密钥' },
            { min: 32, message: '请输入有效的 API 密钥' }
          ]}
        >
          <Input.Password placeholder="请输入您的 API 密钥" />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default AISetupModal
