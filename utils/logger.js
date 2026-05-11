const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LEVELS.INFO;

function ts() {
  return new Date().toISOString();
}

function fmt(level, tag, msg, extra) {
  const base = `[${ts()}] [${level}] ${tag ? `[${tag}] ` : ''}${msg}`;
  return extra ? `${base} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}` : base;
}

export const log = {
  debug: (msg, tag, extra) => { if (MIN_LEVEL <= LEVELS.DEBUG) console.debug(fmt('DEBUG', tag, msg, extra)); },
  info:  (msg, tag, extra) => { if (MIN_LEVEL <= LEVELS.INFO)  console.info(fmt('INFO ', tag, msg, extra)); },
  warn:  (msg, tag, extra) => { if (MIN_LEVEL <= LEVELS.WARN)  console.warn(fmt('WARN ', tag, msg, extra)); },
  error: (msg, tag, extra) => { if (MIN_LEVEL <= LEVELS.ERROR) console.error(fmt('ERROR', tag, msg, extra)); },
  sched: (msg, tag)        => { if (MIN_LEVEL <= LEVELS.INFO)  console.info(fmt('SCHED', tag, msg)); },
};

// Heartbeat: logs uptime every hour so you can see the process is alive in Railway logs
let startTime = Date.now();
setInterval(() => {
  const uptimeMins = Math.floor((Date.now() - startTime) / 60000);
  log.info(`Uptime: ${uptimeMins}m`, 'heartbeat');
}, 60 * 60 * 1000);

export default log;
