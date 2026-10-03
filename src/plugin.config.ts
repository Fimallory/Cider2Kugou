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
    description: 'Generate an Apple-style song poster (flowing artwork) and copy PNG to clipboard from Share menus.',
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
