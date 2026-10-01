# Trusted disposable control plane only. No host socket/mount or API secrets.
ARG ENGINE_BASE=docker:28.5.1-dind@sha256:ea9d20492ca1caaaba78e68453433895d256173c79281756e88b745647fcbcfd
FROM ${ENGINE_BASE}
RUN apk add --no-cache curl=8.14.1-r3 zstd=1.5.7-r0 tar=1.35-r3 python3=3.12.15-r0
RUN curl -fsSL https://storage.googleapis.com/gvisor/releases/release/20260928.0/x86_64/gvisor.tar.zstd -o /tmp/gvisor.tar.zstd \
 && echo '4ce35ca83aef7f96b06cde668e0b23aa98b05aa1829508e974196c2a1e02786c95f5bf79315fd7ddcfd88fe7a00f083ed8053e25eff7673d28d5256440caae8b  /tmp/gvisor.tar.zstd' | sha512sum -c - \
 && tar --zstd -xf /tmp/gvisor.tar.zstd -C /usr/local/bin \
 && rm /tmp/gvisor.tar.zstd \
 && runsc --version
COPY daemon.json /etc/docker/daemon.json
COPY executor.py /opt/forge/executor.py
COPY watchdog.py engine-entrypoint.sh /opt/forge/
RUN chmod 500 /opt/forge/engine-entrypoint.sh
ENV DOCKER_TLS_CERTDIR=""
ENTRYPOINT ["/opt/forge/engine-entrypoint.sh"]
CMD ["dockerd", "--host=unix:///var/run/docker.sock", "--storage-driver=overlay2", "--iptables=false", "--bridge=none"]
