# The event gateway's chat write path, small: it stamps every write with the gateway's own batch, as the event's
# gateway does, so a viewer whose gateway pays holds no stamp. Reads pass unchanged.
FROM nginx:1.30.4-alpine@sha256:dc5069ad14f19660b141b21236140b91656bf89bbc3e2417c70ae650cd66104c
COPY default.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 8080
