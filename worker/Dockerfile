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
COPY lib/scan.js ${LAMBDA_TASK_ROOT}/lib/scan.js

CMD ["handler.handler"]
