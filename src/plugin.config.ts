/**
 * Plugin configuration.
 */
export default {
    /**
     * Custom element prefix, must be unique
     */
    ce_prefix: 'share-poster',
    identifier: 'cider.share-poster',
    name: 'Share Poster',
    description: 'Apple-style song poster with inline KuGou match and scannable QR plate. No dialogs.',
    version: '0.1.0',
    author: 'you',
    repo: 'https://github.com/ciderapp/plugin-template',
    pluginKitVersion: '4',
    entry: {
        'plugin.js': {
            type: 'main',
        }
    }
}
