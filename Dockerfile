# Stage 1: Build the React + TypeScript frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Production Python Backend with model inference and static serving
FROM python:3.13-slim

RUN useradd -m -u 1000 appuser

ENV HOME=/home/appuser \
    PATH=/home/appuser/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DATABASE_PATH=/var/data/rtoguard.db

# Create persistent data directory and set permissions
RUN mkdir -p /var/data && chown -R appuser:appuser /var/data

USER appuser
WORKDIR $HOME/app

COPY --chown=appuser backend/requirements-serve.txt ./
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements-serve.txt

# Copy backend code, models, and data
COPY --chown=appuser backend/ ./backend/

# Copy built frontend assets for unified single-port serving
COPY --from=frontend-builder --chown=appuser /app/frontend/dist ./frontend/dist

WORKDIR $HOME/app/backend

ENV PORT=8000
EXPOSE 8000

# Run FastAPI serving both API and frontend on injected $PORT
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}"]
