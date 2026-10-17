# App Engine custom runtime for the LL-DASH assignment.
#
# GPAC comes from a pinned course image rather than from an upstream URL. GPAC publishes
# nightly builds and prunes the directory, so a URL you pin today stops working; the course
# holds one known-good build so that everyone -- you, the model solution and the grader --
# packages with the same version. Do not substitute another GPAC build: a different version
# can write different attributes into the manifest and change how your stream is graded.
FROM cse4265/gpac@sha256:4077636dc030b91c4c3b93b243ac8a521c4bb36826d0e0a5908fcf1d86309b83

WORKDIR /server
COPY server/. .

# Create GPAC's temporary cache directory
RUN mkdir -p /tmp/gpac_cache && chmod 1777 /tmp/gpac_cache

# Expose ports
EXPOSE 8080

# Start serving

CMD ["/bin/sh", "-c", "exec gpac flist:srcs=testvideo.mp4#video:floop=-1 flist:srcs=testvideo.mp4#audio:floop=-1 reframer:rt=on --tfdt_traf -o http://0.0.0.0:8080/out.mpd:gpac:segdur=6:cdur=0.2:asto=5.6:profile=live:dmode=dynamic:rdirs=/server"]
