# nest-engine (engine/) uses Rust edition 2024, requiring Rust >= 1.88.
FROM rust:1.88 AS builder

WORKDIR /app

# Only the engine workspace is needed to build the binary.
COPY engine ./engine

WORKDIR /app/engine
RUN cargo build --release

# Stage 2: Create the final runtime image
FROM python:3.11-slim

# Create a non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser

WORKDIR /app

# Upgrade pip to latest version
RUN pip install --upgrade pip

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the built nest-engine binary from the builder stage
COPY --from=builder /app/engine/target/release/nest-engine /usr/local/bin/nest-engine
RUN chmod +x /usr/local/bin/nest-engine

# Copy the Python application code
COPY . .

# Change ownership of the app directory to the non-root user
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Verify nest-engine is available
RUN nest-engine --help || echo "nest-engine help check failed"

CMD ["python", "main.py"]
