# ---- Stage 1: Build the React frontend ----
FROM node:20-slim AS frontend-build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY index.html vite.config.js tailwind.config.js postcss.config.js ./
COPY src ./src
COPY public ./public

# Set this at build time (in render.yaml) to your deployed backend's URL,
# e.g. https://jarvis-backend.onrender.com - so the built frontend knows
# where to find the API/socket server. If left blank, the frontend assumes
# same-origin (works when backend serves the frontend itself, as this
# Dockerfile does).
ARG VITE_BACKEND_URL=""
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
RUN npm run build

# ---- Stage 2: Python backend, serving the built frontend too ----
FROM python:3.11-slim
WORKDIR /app

# System dependencies:
# - portaudio19-dev: needed to install/import pyaudio (even though HOSTED_MODE
#   skips actually opening a mic/speaker stream, the library still needs
#   this to load at all)
# - libgl1 + libglib2.0-0: needed by opencv-python (cv2) at runtime
# - build-essential: needed to compile a couple of the Python dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    portaudio19-dev \
    libgl1 \
    libglib2.0-0 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY --from=frontend-build /app/dist ./dist

# Render sets $PORT automatically and expects the app to bind to it.
# HOSTED_MODE=true disables all local mic/camera/speaker access, since a
# cloud container has none of that hardware - audio/video instead flow
# through the browser via the socket connection. Set the rest of the real
# secrets (GEMINI_API_KEY, AUTH_PASSWORD, SUPABASE_URL, etc.) in Render's
# dashboard, not here - never bake real credentials into the image.
ENV HOSTED_MODE=true
EXPOSE 8000

CMD ["python", "backend/server.py"]
