#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Python代码跟练系统API服务器

这个服务器提供RESTful API，用于前端React应用与后端Python代码交互
"""

import os
import re
import json
import traceback
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from ai_helper import AITutor
import configparser

app = Flask(__name__, static_folder='./dist')
CORS(app)  # 允许跨域请求

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


def extract_code_blocks(md_content):
    """从Markdown内容中提取Python代码块"""
    pattern = r'```python\n(.+?)\n```'
    return re.findall(pattern, md_content, re.DOTALL)


def extract_sections(md_content):
    """从Markdown内容中提取章节"""
    sections = []
    current_section = {"title": "", "content": "", "code_blocks": []}

    lines = md_content.split('\n')
    for line in lines:
        if line.startswith('## '):
            if current_section["title"]:
                sections.append(current_section)
            current_section = {"title": line[3:], "content": line + '\n', "code_blocks": []}
        elif line.startswith('### '):
            current_section["content"] += line + '\n'
        else:
            current_section["content"] += line + '\n'

    if current_section["title"]:
        sections.append(current_section)

    # 提取每个章节中的代码块
    for section in sections:
        section["code_blocks"] = extract_code_blocks(section["content"])

    return sections


def run_code(code):
    """运行用户输入的代码并捕获输出和错误"""
    # 创建一个临时的命名空间，同时用于全局和本地
    namespace = {}

    try:
        # 重定向标准输出以捕获print输出
        import io
        from contextlib import redirect_stdout

        f = io.StringIO()
        with redirect_stdout(f):
            exec(code, namespace, namespace)

        output = f.getvalue()
        return {"success": True, "output": output, "vars": namespace}
    except Exception as e:
        error_msg = traceback.format_exc()
        return {"success": False, "output": error_msg, "vars": namespace}

#用户自定义对模型和Key的操作

def operate_model_key(operate:str,model_name:str=None,key_name:str=None,model_key:str=None):
    config_file_path = Path(__file__).parent / "config.ini"
    config = configparser.ConfigParser()
    config.read(config_file_path)
    if operate == 'push':
        if not config.has_section(model_name):
            config.add_section(model_name)
        keys = config.options(model_name)
        if key_name in keys:
            return {"error": f'密钥已存在:{key_name}'}
        config.set(model_name,key_name, model_key)
        with open(config_file_path, 'w') as configfile:
            config.write(configfile)
        return {"success": f'密钥添加成功:{key_name}'}
    elif operate == 'delete':
        if model_name and not key_name:
            config.remove_section(model_name)
            return {"success": f'模型移除成功:{key_name}'}
        config.remove_option(model_name, key_name)
        with open(config_file_path, 'w') as configfile:
            config.write(configfile)
        return {"success": f'密钥移除成功:{key_name}'}
    elif operate == 'get':
        all_key_value = {}
        for section in config.sections():
            all_key_value[section] = dict(config.items(section))
        return {"success": f'成功获取模型密钥列表',"key_values": all_key_value}
    else:
        return {"error": "请求方法错误"}, 405



    

@app.route('/api/tutorials', methods=['GET'])
def get_tutorials():
    """获取所有可用教程"""
    tutorials_list = []
    for key, value in TUTORIALS.items():
        tutorials_list.append({
            "key": key,
            "title": key,
            "file": value
        })
    return jsonify(tutorials_list)


@app.route('/api/tutorial/<tutorial_key>', methods=['GET'])
def get_tutorial(tutorial_key):
    """获取特定教程的内容"""
    if tutorial_key not in TUTORIALS:
        return jsonify({"error": f"未找到教程 '{tutorial_key}'"}), 404

    # 读取Markdown文件
    md_file = Path(__file__).parent / "notes" / TUTORIALS[tutorial_key]
    if not md_file.exists():
        return jsonify({"error": f"未找到Markdown文件 '{md_file}'"}), 404

    with open(md_file, 'r', encoding='utf-8') as f:
        md_content = f.read()

    # 提取章节
    sections = extract_sections(md_content)

    # 获取教程标题
    title = md_content.split('\n')[0].lstrip('#').strip()

    return jsonify({
        "title": title,
        "sections": sections
    })


@app.route('/api/run-code', methods=['POST'])
def execute_code():
    """运行用户提交的代码"""
    data = request.json
    user_code = data.get('code', '')
    expected_code = data.get('expected_code', '')

    if not user_code:
        return jsonify({"error": "没有提供代码"}), 400

    # 运行代码
    result = run_code(user_code)

    # 如果有预期代码，使用AI评估
    ai_evaluation = None
    if expected_code and result["success"]:
        try:
            ai_tutor = AITutor()
            ai_result = ai_tutor.evaluate_code(expected_code, user_code, result["output"])
            ai_evaluation = {"passed": ai_result}
        except Exception as e:
            ai_evaluation = {"error": str(e)}

    return jsonify({
        "success": result["success"],
        "output": result["output"],
        "ai_evaluation": ai_evaluation
    })


@app.route('/api/hint', methods=['POST'])
def get_hint():
    """获取代码提示"""

    data = request.json
    user_code = data.get('code', '')
    expected_code = data.get('expected_code', '')
    actual_output = data.get('actual_output', '')

    if not user_code or not expected_code:
        return jsonify({"error": "缺少必要参数"}), 400

    try:
        ai_tutor = AITutor()
        hint = ai_tutor.generate_hint(
            user_code=user_code,
            expected_output=expected_code,
            actual_output=actual_output
        )
        return jsonify({"hint": hint})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/solution', methods=['POST'])
def get_solution():
    """获取代码解决方案"""
    data = request.json
    user_code = data.get('code', '')
    expected_code = data.get('expected_code', '')
    actual_output = data.get('actual_output', '')

    if not expected_code:
        return jsonify({"error": "缺少必要参数"}), 400

    try:
        ai_tutor = AITutor()
        solution = ai_tutor.generate_solution(
            user_code=user_code,
            expected_output=expected_code,
            actual_output=actual_output
        )
        return jsonify({"solution": solution})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

#管理模型和Key接口
@app.route('/api/model_key', methods=['POST'])
def model_key():
    data = request.json
    model_name = data.get('model_name', '')
    key_name = data.get('key_name', '')
    model_key = data.get('model_key', '')
    operate = data.get('operate')
    return operate_model_key(operate,model_name,key_name,model_key)



# 前端路由处理
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path != "" and os.path.exists(app.static_folder + '/' + path):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, 'index.html')


if __name__ == "__main__":
    app.run(debug=True, port=5000)
