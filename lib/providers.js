export class ProviderRegistry {
    providers = new Map();
    log;
    constructor(options) {
        this.log = options.log;
    }
    register(provider) {
        if (this.providers.has(provider.info.id)) {
            throw new Error('TTS provider 已注册：' + provider.info.id);
        }
        this.providers.set(provider.info.id, provider);
        this.log('info', '已注册 TTS 引擎：' + provider.info.label + '（' + provider.info.id + '）');
        return () => {
            this.providers.delete(provider.info.id);
        };
    }
    get(id) {
        return this.providers.get(id);
    }
    /** 所有可用 provider 的 id/label（设置页与 doctor 用） */
    list() {
        return [...this.providers.values()].map(provider => provider.info);
    }
}
