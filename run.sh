#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
VENV_DIR="$BACKEND_DIR/.venv"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    trap - EXIT INT TERM

    if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        kill "$BACKEND_PID" 2>/dev/null || true
    fi

    if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        kill "$FRONTEND_PID" 2>/dev/null || true
    fi

    wait "$BACKEND_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm is required but was not found." >&2
    exit 1
fi

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
    echo "Creating the backend virtual environment..."

    if command -v uv >/dev/null 2>&1; then
        uv venv --python 3.13 "$VENV_DIR"
        uv pip install --python "$VENV_DIR/bin/python" -r "$BACKEND_DIR/requirements.txt"
    elif command -v python3 >/dev/null 2>&1; then
        python3 -m venv "$VENV_DIR"
        "$VENV_DIR/bin/python" -m pip install --upgrade pip
        "$VENV_DIR/bin/python" -m pip install -r "$BACKEND_DIR/requirements.txt"
    else
        echo "Error: Python 3 is required but was not found." >&2
        exit 1
    fi
fi

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    echo "Installing frontend dependencies..."
    (cd "$FRONTEND_DIR" && npm ci)
fi

echo "Applying database migrations..."
(cd "$BACKEND_DIR" && "$VENV_DIR/bin/python" manage.py migrate)

echo "Ensuring demo login data exists..."
(cd "$BACKEND_DIR" && "$VENV_DIR/bin/python" manage.py seed_demo)

echo "Starting ORION CRM..."
echo "Frontend: Vite will print its URL below (normally http://localhost:5173)"
echo "Backend:  http://localhost:8000"
echo ""
echo "Demo login credentials:"
echo "  Owner:   demo@crm.com / demo1234"
echo "  Manager: sales@crm.com / demo1234"
echo ""
echo "Press Ctrl+C to stop both servers."

(cd "$BACKEND_DIR" && exec "$VENV_DIR/bin/python" manage.py runserver) &
BACKEND_PID=$!

(cd "$FRONTEND_DIR" && exec npm run dev) &
FRONTEND_PID=$!

wait -n "$BACKEND_PID" "$FRONTEND_PID"
