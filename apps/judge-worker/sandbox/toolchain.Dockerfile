ARG TOOLCHAIN_BASE=node:22.20.0-bookworm-slim@sha256:b21fe589dfbe5cc39365d0544b9be3f1f33f55f3c86c87a76ff65a02f8f5848e
FROM ${TOOLCHAIN_BASE}
RUN apt-get update && apt-get install -y --no-install-recommends g++=4:12.2.0-3 python3=3.11.2-1+b1 openjdk-17-jdk-headless=17.0.20.1+1-1~deb12u1 nlohmann-json3-dev=3.11.2-2 \
 && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /work /code && chown 65534:65534 /work /code \
 && (g++ --version; python3 --version; javac -version; java -version; node --version; dpkg-query -W g++ python3 openjdk-17-jdk-headless nlohmann-json3-dev) > /toolchain-versions.txt 2>&1
WORKDIR /work
USER 65534:65534
ENV HOME=/work LANG=C.UTF-8 LC_ALL=C.UTF-8
