# M2 worker Lambda. Build from the repo root so this can reach lib/scan.js:
#   docker build -f worker/Dockerfile -t a11y-auditor-worker .
#
# @sparticuz/chromium ships a prebuilt Chromium targeting exactly this
# Amazon-Linux-2023 Lambda base image, so no extra system packages are
# needed to get a working headless browser.

FROM public.ecr.aws/lambda/nodejs:20

COPY worker/package.json worker/package-lock.json* ${LAMBDA_TASK_ROOT}/
RUN npm install --omit=dev

COPY worker/handler.js ${LAMBDA_TASK_ROOT}/
# lib/ files are copied individually, not as a directory — a new module
# added here must be listed, or it silently won't exist in the image and
# you'll get MODULE_NOT_FOUND at cold start after a clean local test.
COPY lib/scan.js ${LAMBDA_TASK_ROOT}/lib/scan.js
COPY lib/explain.js ${LAMBDA_TASK_ROOT}/lib/explain.js

CMD ["handler.handler"]
