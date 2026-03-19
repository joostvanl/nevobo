'use strict';

const path = require('path');

/** Repo `public/` directory (from server/routes/social/) */
const publicDir = path.join(__dirname, '..', '..', '..', 'public');

function publicPath(relativeFilePath) {
  if (!relativeFilePath) return publicDir;
  const clean = String(relativeFilePath).replace(/^[/\\]+/, '');
  return path.join(publicDir, clean);
}

module.exports = { publicDir, publicPath };
