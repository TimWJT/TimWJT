import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// The editor POSTs here to write the config and both SVGs straight to disk.
const saveBanner = {
  name: 'save-banner',
  configureServer(server) {
    server.middlewares.use('/__save', (req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const { config, svgs } = JSON.parse(body);
          fs.writeFileSync(path.join(root, 'banner.config.json'), `${JSON.stringify(config, null, 2)}\n`);
          for (const [name, svg] of Object.entries(svgs)) {
            fs.writeFileSync(path.join(root, 'assets', `banner-${name.replace(/\W/g, '')}.svg`), svg);
          }
          res.end('ok');
        } catch (err) {
          res.statusCode = 500;
          res.end(String(err));
        }
      });
    });
  },
};

export default {
  plugins: [saveBanner],
  server: { open: '/editor/' },
};
