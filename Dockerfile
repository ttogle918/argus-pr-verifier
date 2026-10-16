FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

# Install core web & Gemini runtime dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir \
    fastapi \
    uvicorn \
    pydantic \
    requests \
    httpx \
    tenacity \
    google-genai \
    google-auth

# Copy application source, static frontend, docs, and pre-seeded SQLite DB (backend/argus_pr.db)
COPY backend ./backend
COPY frontend ./frontend
COPY docs ./docs

EXPOSE 8080

CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
