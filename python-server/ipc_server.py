#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Python代码跟练系统IPC服务器

这个服务器通过标准输入/输出与Electron主进程通信，替代原有的HTTP通信方式
"""

import os
import sys
import json
import signal
import traceback
from pathlib import Path
from threading import Thread
from ai_helper import AITutor


# 教程映射表
TUTORIALS = {
    "演练广场": "chapter00.md",
    "基础知识": "chapter01.md",
    "Python序列": "chapter02.md",
    "选择与循环": "chapter03.md",
    "字符串与正则表达式": "chapter04.md",
    "函数的设计和使用": "chapter05.md",
    "面向对象程序设计": "chapter06.md",
    "文件操作": "chapter07.md",
    "异常处理": "chapter08.md",
    "GUI操作": "chapter09.md"
}


class IPCServer:
    """IPC服务器类，处理与Electron的通信"""

    def __init__(self):
        self.running = True
        # 从api_server.py导入的函数
        from api_server import extract_code_blocks, extract_sections, run_code,operate_model_key
        self.operate_model_key = operate_model_key
        self.extract_code_blocks = extract_code_blocks
        self.extract_sections = extract_sections
        self.run_code = run_code
        # 注册信号处理器
        self._setup_signal_handlers()

    def _setup_signal_handlers(self):
        """设置信号处理器以确保优雅退出"""
        # 处理SIGTERM信号（进程终止信号）
        def handle_sigterm(signum, frame):
            print(json.dumps({"status": "shutdown", "message": "Received SIGTERM, shutting down"}), flush=True)
            self.running = False
            sys.exit(0)

        # 处理SIGINT信号（键盘中断，如Ctrl+C）
        def handle_sigint(signum, frame):
            print(json.dumps({"status": "shutdown", "message": "Received SIGINT, shutting down"}), flush=True)
            self.running = False
            sys.exit(0)

        # 注册信号处理器
        if sys.platform == 'win32':
            # Windows平台使用不同的信号处理方式
            try:
                signal.signal(signal.SIGTERM, handle_sigterm)
                signal.signal(signal.SIGINT, handle_sigint)
            except (AttributeError, ValueError) as e:
                print(json.dumps({"status": "warning", "message": f"无法设置信号处理器: {str(e)}"}), flush=True)
        else:
            # Unix/Linux/MacOS平台
            signal.signal(signal.SIGTERM, handle_sigterm)
            signal.signal(signal.SIGINT, handle_sigint)

    def start(self):
        """启动IPC服务器"""
        print(json.dumps({"status": "ready", "message": "IPC server has started"}), flush=True)

        # 启动输入监听线程
        input_thread = Thread(target=self._listen_for_input)
        input_thread.daemon = True
        input_thread.start()

        # 主线程保持运行
        try:
            input_thread.join()
        except KeyboardInterrupt:
            self.running = False
            print(json.dumps({"status": "shutdown", "message": "IPC server has shut down"}), flush=True)

    def _listen_for_input(self):
        """监听标准输入的消息"""
        while self.running:
            try:
                # 从标准输入读取一行JSON数据
                line =  sys.stdin.readline().encode('utf-8').decode('unicode_escape').strip()
                if not line:
                    continue

                # 解析JSON数据
                try:
                    data = json.loads(line)
                    self._process_message(data)
                except json.JSONDecodeError as e:
                    self._send_error(f"Invalid JSON data: {str(e)} | {line}")
            except Exception as e:
                self._send_error(f"Error processing input: {str(e)}")

    def _process_message(self, data):
        """处理接收到的消息"""
        try:
            command = data.get("command")
            payload = data.get("payload", {})
            request_id = data.get("requestId")

            if command == "get_tutorials":
                self._handle_get_tutorials(request_id)
            elif command == "get_tutorial":
                self._handle_get_tutorial(payload, request_id)
            elif command == "run_code":
                self._handle_run_code(payload, request_id)
            elif command == "run_code_simple":
                self._handle_run_code_simple(payload, request_id)
            elif command == "test":
                self._handle_test(payload, request_id)
            elif command == "get_hint":
                self._handle_get_hint(payload, request_id)
            elif command == "get_solution":
                self._handle_get_solution(payload, request_id)
            elif command == "model_key":
                self._handle_model_key(payload, request_id)
            else:
                self._send_error(f"Unknown command: {command}", request_id)
        except Exception as e:
            self._send_error(f"Error processing message: {str(e)}\n{traceback.format_exc()}", data.get("requestId"))

    def _handle_get_tutorials(self, request_id=None):
        """处理获取所有教程的请求"""
        tutorials_list = []
        for key, value in TUTORIALS.items():
            tutorials_list.append({
                "key": key,
                "title": key,
                "file": value
            })
        self._send_response({"tutorials": tutorials_list}, request_id)

    def _handle_get_tutorial(self, payload, request_id=None):
        """处理获取特定教程内容的请求"""
        tutorial_key = payload.get("tutorialKey")
        if not tutorial_key or tutorial_key not in TUTORIALS:
            self._send_error(f"Tutorial '{tutorial_key}' not found", request_id)
            return

        # 读取Markdown文件
        md_file = Path(__file__).parent / "notes" / TUTORIALS[tutorial_key]
        if not md_file.exists():
            self._send_error(f"Markdown file '{md_file}' not found", request_id)
            return

        try:
            with open(md_file, 'r', encoding='utf-8') as f:
                md_content = f.read()

            # 提取章节
            sections = self.extract_sections(md_content)

            # 获取教程标题
            title = md_content.split('\n')[0].lstrip('#').strip()

            self._send_response({
                "title": title,
                "sections": sections
            }, request_id)
        except Exception as e:
            self._send_error(f"Error reading tutorial content: {str(e)}", request_id)

    def _handle_run_code(self, payload, request_id=None):
        """处理运行代码的请求"""
        user_code = payload.get("code", "")
        expected_code = payload.get("expected_code", "")

        if not user_code:
            self._send_error("No code provided", request_id)
            return

        # 运行代码
        result = self.run_code(user_code)

        # 如果有预期代码，使用AI评估
        ai_evaluation = None
        if expected_code and result["success"]:
            try:
                ai_tutor = AITutor()
                ai_result = ai_tutor.evaluate_code(expected_code, user_code, result["output"])
                ai_evaluation = {"passed": ai_result}
            except Exception as e:
                ai_evaluation = {"error": str(e)}

        self._send_response({
            "success": result["success"],
            "output": result["output"],
            "ai_evaluation": ai_evaluation
        }, request_id)

    def _handle_run_code_simple(self, payload, request_id=None):
        """处理运行代码的请求"""
        user_code = payload.get("code", "")

        if not user_code:
            self._send_error("No code provided", request_id)
            return

        # 运行代码
        result = self.run_code(user_code)

        self._send_response({
            "success": result["success"],
            "output": result["output"]
        }, request_id)

    def _handle_test(self, payload, request_id=None):
        """获取代码提示"""
        try:
            ai_tutor = AITutor()
            result = ai_tutor.test()
            self._send_response({"test": result}, request_id)
        except Exception as e:
            self._send_error(f"Error getting hint: {str(e)}", request_id)

    def _handle_get_hint(self, payload, request_id=None):
        """处理获取代码提示的请求"""
        user_code = payload.get("code", "")
        expected_code = payload.get("expected_code", "")
        actual_output = payload.get("actual_output", "")

        if not user_code or not expected_code:
            self._send_error("Missing required parameters", request_id)
            return

        try:
            ai_tutor = AITutor()
            hint = ai_tutor.generate_hint(
                user_code=user_code,
                expected_output=expected_code,
                actual_output=actual_output
            )
            self._send_response({"hint": hint}, request_id)
        except Exception as e:
            self._send_error(f"Error getting hint: {str(e)}", request_id)

    def _handle_get_solution(self, payload, request_id=None):
        """处理获取代码解决方案的请求"""
        user_code = payload.get("code", "")
        expected_code = payload.get("expected_code", "")
        actual_output = payload.get("actual_output", "")

        if not expected_code:
            self._send_error("Missing required parameters", request_id)
            return

        try:
            ai_tutor = AITutor()
            solution = ai_tutor.generate_solution(
                user_code=user_code,
                expected_output=expected_code,
                actual_output=actual_output
            )
            self._send_response({"solution": solution}, request_id)
        except Exception as e:
            self._send_error(f"Error getting solution: {str(e)}", request_id)


    def _handle_model_key(self, payload, request_id=None):
        """处理模型密钥的请求"""
        operate = payload.get("operate", "")
        model_name = payload.get("model_name", "")
        base_url = payload.get("base_url", "")
        encrypted_api_key = payload.get("encrypted_api_key", "")
        aes_key = payload.get("aes_key", "")
        iv = payload.get("iv", "")
        
        if not operate:
            self._send_error("Missing required parameters", request_id)
            return
        try:
            response = self.operate_model_key(operate, base_url, model_name,encrypted_api_key, aes_key, iv)
            self._send_response({"model_key": response}, request_id)
        except Exception as e:
            self._send_error(f"Error {operate} model key: {str(e)}", request_id)

    def _send_response(self, data, request_id=None):
        """发送响应数据（支持流式传输）"""
        response = {
            "status": "success",
            "data": data
        }
        if request_id:
            response["requestId"] = request_id

        # 将响应转换为JSON字符串
        json_str = json.dumps(response)

        # 如果响应小于8KB，直接发送
        if len(json_str) < 8000:
            print(json_str, flush=True)
            return

        # 否则分块发送
        chunk_size = 8000  # 每块大小约8KB，减小块大小以避免解析问题
        total_chunks = (len(json_str) + chunk_size - 1) // chunk_size

        # 发送开始标记
        print(json.dumps({
            "status": "stream_start",
            "total_chunks": total_chunks,
            "requestId": request_id
        }), flush=True)

        # 分块发送数据
        for i in range(total_chunks):
            chunk = json_str[i * chunk_size:(i + 1) * chunk_size]
            print(json.dumps({
                "status": "stream_chunk",
                "chunk_index": i,
                "chunk_data": chunk,
                "requestId": request_id
            }), flush=True)
            # 添加小延迟，避免数据发送过快导致接收端缓冲区溢出
            import time
            time.sleep(0.01)

        # 发送结束标记
        print(json.dumps({
            "status": "stream_end",
            "requestId": request_id
        }), flush=True)

    def _send_error(self, message, request_id=None):
        """发送错误消息（支持流式传输）"""
        error = {
            "status": "error",
            "message": message
        }
        if request_id:
            error["requestId"] = request_id

        # 将错误转换为JSON字符串
        json_str = json.dumps(error)

        # 如果错误消息小于8KB，直接发送
        if len(json_str) < 8000:
            print(json_str, flush=True)
            return

        # 否则分块发送
        chunk_size = 8000  # 每块大小约8KB，减小块大小以避免解析问题
        total_chunks = (len(json_str) + chunk_size - 1) // chunk_size

        # 发送开始标记
        print(json.dumps({
            "status": "stream_start",
            "total_chunks": total_chunks,
            "requestId": request_id
        }), flush=True)

        # 分块发送数据
        for i in range(total_chunks):
            chunk = json_str[i * chunk_size:(i + 1) * chunk_size]
            print(json.dumps({
                "status": "stream_chunk",
                "chunk_index": i,
                "chunk_data": chunk,
                "requestId": request_id
            }), flush=True)
            # 添加小延迟，避免数据发送过快导致接收端缓冲区溢出
            import time
            time.sleep(0.01)

        # 发送结束标记
        print(json.dumps({
            "status": "stream_end",
            "requestId": request_id
        }), flush=True)


if __name__ == "__main__":
    server = IPCServer()
    server.start()
