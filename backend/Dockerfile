# 使用官方 Python 环境作为基础
FROM python:3.9

# 设置工作目录
WORKDIR /code

# 1. 先只复制清单文件，安装依赖 (这样利用缓存，速度快)
COPY ./backend/requirements.txt /code/requirements.txt

# 2. 安装 Python 库 (加个镜像源下载更快)
RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 3. 安装 OpenCV 必须的系统库 (这一步最关键，Render 就是缺这个)
RUN apt-get update && apt-get install -y libgl1-mesa-glx

# 4. 复制后端代码到容器里
COPY ./backend /code/app

# 5. 启动服务 (Hugging Face 默认端口是 7860)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]