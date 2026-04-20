FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    libmosquitto-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY . .

RUN cmake -S . -B build \
  && cmake --build build --config Release \
  && ctest --test-dir build --output-on-failure

EXPOSE 8080

CMD ["./build/farm_cpp_api"]
