FROM node:22-bookworm-slim

WORKDIR /app

# Install Python for the validated quant pipeline
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv python3-pip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Isolated Python environment used by the quant pipeline
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY package*.json ./
RUN npm ci --omit=dev

COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

ENV NODE_ENV=production
ENV PYTHON_EXECUTABLE=/opt/venv/bin/python

EXPOSE 8080

# PRAN AI v2 contains the current /api/ask, analysis and AI routes.
CMD ["node", "server-v2.js"]
