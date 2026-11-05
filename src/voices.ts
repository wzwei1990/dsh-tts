/**
 * 音色目录（2026-11-05）。
 *
 * 来源：
 *   - Edge：官方 voices/list 接口实测可拉（322 个音色，其中 zh-CN 8 个）；内置常用清单做兜底。
 *   - 火山方舟：控制台 ListSpeakers 接口（ResourceID=seed-tts-2.0）实测拉取，共 472 个音色；
 *     这里收录「性别=女 + 中英混」的 54 个（用户在控制台就是这么筛的）。
 *     要别的音色，在下拉框选「自定义」填 voice_type 即可。
 */
export interface VoiceOption {
  /** 传给引擎的值 */
  id: string
  /** 下拉框里显示的文字 */
  label: string
  /** 语言/方言，便于分组 */
  locale?: string
}

/** Edge 常用音色（实测自官方 voices/list；只收女声） */
export const EDGE_VOICES: VoiceOption[] = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女声（最常用）', locale: 'zh-CN' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊 · 女声', locale: 'zh-CN' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北 · 女声（东北话）', locale: 'zh-CN-liaoning' },
  { id: 'zh-CN-shaanxi-XiaoniNeural', label: '晓妮 · 女声（陕西话）', locale: 'zh-CN-shaanxi' },
  { id: 'zh-TW-HsiaoChenNeural', label: '曉臻 · 女声（台湾）', locale: 'zh-TW' },
  { id: 'zh-TW-HsiaoYuNeural', label: '曉雨 · 女声（台湾）', locale: 'zh-TW' },
  { id: 'zh-HK-HiuMaanNeural', label: '曉曼 · 女声（粤语）', locale: 'zh-HK' },
  { id: 'zh-HK-HiuGaaiNeural', label: '曉佳 · 女声（粤语）', locale: 'zh-HK' },
  { id: 'ja-JP-NanamiNeural', label: 'ナナミ · 女声（日语）', locale: 'ja-JP' },
  { id: 'en-US-AriaNeural', label: 'Aria · 女声（英语）', locale: 'en-US' },
  { id: 'en-US-JennyNeural', label: 'Jenny · 女声（英语）', locale: 'en-US' },
]

/** 火山方舟「豆包语音合成 2.0」：性别=女 + 中英混（控制台 ListSpeakers 实测 54 个） */
export const VOLC_SPEAKERS: VoiceOption[] = [
  { id: 'zh_female_vv_uranus_bigtts', label: 'Vivi 2.0 · 主打 · 语调平稳、治愈', locale: 'zh-CN' },
  { id: 'zh_female_xiaohe_uranus_bigtts', label: '小何 2.0 · 主打 · 甜美有活力', locale: 'zh-CN' },
  { id: 'zh_female_sophie_uranus_bigtts', label: '魅力苏菲 2.0 · 高冷御姐', locale: 'zh-CN' },
  { id: 'zh_female_meilinvyou_uranus_bigtts', label: '魅力女友 2.0 · 妩媚御姐', locale: 'zh-CN' },
  { id: 'zh_female_gaolengyujie_uranus_bigtts', label: '高冷御姐 2.0', locale: 'zh-CN' },
  { id: 'zh_female_wenroumama_uranus_bigtts', label: '温柔妈妈 2.0 · 母性治愈', locale: 'zh-CN' },
  { id: 'zh_female_sajiaoxuemei_uranus_bigtts', label: '撒娇学妹 2.0', locale: 'zh-CN' },
  { id: 'zh_female_tianmeitaozi_uranus_bigtts', label: '甜美桃子 2.0', locale: 'zh-CN' },
  { id: 'zh_female_tianmeixiaoyuan_uranus_bigtts', label: '甜美小源 2.0', locale: 'zh-CN' },
  { id: 'zh_female_tianmeiyueyue_uranus_bigtts', label: '甜美悦悦 2.0', locale: 'zh-CN' },
  { id: 'zh_female_qingxinnvsheng_uranus_bigtts', label: '清新女声 2.0', locale: 'zh-CN' },
  { id: 'zh_female_qingchezizi_uranus_bigtts', label: '清澈梓梓 2.0', locale: 'zh-CN' },
  { id: 'zh_female_cancan_uranus_bigtts', label: '知性灿灿 2.0', locale: 'zh-CN' },
  { id: 'zh_female_zhixingnv_uranus_bigtts', label: '知性女声 2.0', locale: 'zh-CN' },
  { id: 'zh_female_shuangkuaisisi_uranus_bigtts', label: '爽快思思 2.0', locale: 'zh-CN' },
  { id: 'zh_female_linjianvhai_uranus_bigtts', label: '邻家女孩 2.0', locale: 'zh-CN' },
  { id: 'zh_female_kailangjiejie_uranus_bigtts', label: '开朗姐姐 2.0', locale: 'zh-CN' },
  { id: 'zh_female_wenrouxiaoya_uranus_bigtts', label: '温柔小雅 2.0', locale: 'zh-CN' },
  { id: 'zh_female_wenroushunv_uranus_bigtts', label: '温柔淑女 2.0', locale: 'zh-CN' },
  { id: 'zh_female_roumeinvyou_uranus_bigtts', label: '柔美女友 2.0', locale: 'zh-CN' },
  { id: 'zh_female_gufengshaoyu_uranus_bigtts', label: '古风少御 2.0', locale: 'zh-CN' },
  { id: 'zh_female_lingling_uranus_bigtts', label: '玲玲姐姐 2.0', locale: 'zh-CN' },
  { id: 'zh_female_linxiao_uranus_bigtts', label: '林潇 2.0 · 角色扮演', locale: 'zh-CN' },
  { id: 'zh_female_chunribu_uranus_bigtts', label: '春日部姐姐 2.0', locale: 'zh-CN' },
  { id: 'zh_female_mengyatou_uranus_bigtts', label: '萌丫头 2.0', locale: 'zh-CN' },
  { id: 'zh_female_qiaopinv_uranus_bigtts', label: '俏皮女声 2.0', locale: 'zh-CN' },
  { id: 'zh_female_tiexinnvsheng_uranus_bigtts', label: '贴心女声 2.0', locale: 'zh-CN' },
  { id: 'zh_female_qinqienv_uranus_bigtts', label: '亲切女声 2.0', locale: 'zh-CN' },
  { id: 'zh_female_wenjingmaomao_uranus_bigtts', label: '文静毛毛 2.0', locale: 'zh-CN' },
  { id: 'zh_female_kefunvsheng_uranus_bigtts', label: '暖阳女声 2.0 · 客服', locale: 'zh-CN' },
  { id: 'zh_female_liuchangnv_uranus_bigtts', label: '流畅女声 2.0', locale: 'zh-CN' },
  { id: 'zh_female_zhishuaiyingzi_uranus_bigtts', label: '直率英子 2.0', locale: 'zh-CN' },
  { id: 'zh_female_yingyujiaoxue_uranus_bigtts', label: 'Tina老师 2.0 · 教学', locale: 'zh-CN' },
  { id: 'zh_female_xiaoxue_uranus_bigtts', label: '儿童绘本 2.0 · 有声阅读', locale: 'zh-CN' },
  { id: 'zh_female_shaoergushi_uranus_bigtts', label: '少儿故事 2.0 · 有声阅读', locale: 'zh-CN' },
  { id: 'zh_female_jitangmei_uranus_bigtts', label: '鸡汤妹妹 2.0', locale: 'zh-CN' },
  { id: 'zh_female_jitangnv_uranus_bigtts', label: '鸡汤女 2.0', locale: 'zh-CN' },
  { id: 'zh_female_xinlingjitang_uranus_bigtts', label: '心灵鸡汤 2.0', locale: 'zh-CN' },
  { id: 'zh_female_mizai_uranus_bigtts', label: '黑猫侦探社咪仔 2.0 · 视频配音', locale: 'zh-CN' },
  { id: 'zh_female_gujie_uranus_bigtts', label: '顾姐 2.0 · 干练大女主', locale: 'zh-CN' },
  { id: 'zh_female_wuzetian_uranus_bigtts', label: '武则天 2.0 · 角色扮演', locale: 'zh-CN' },
  { id: 'zh_female_peiqi_uranus_bigtts', label: '佩奇猪 2.0 · 视频配音', locale: 'zh-CN' },
  { id: 'zh_female_popo_uranus_bigtts', label: '婆婆 2.0', locale: 'zh-CN' },
  { id: 'zh_female_yingtaowanzi_uranus_bigtts', label: '樱桃丸子 2.0 · 角色扮演', locale: 'zh-CN' },
  { id: 'zh_female_tvbnv_uranus_bigtts', label: 'TVB女声 2.0', locale: 'zh-CN' },
  { id: 'zh_female_nvleishen_uranus_bigtts', label: '女雷神 2.0 · 角色扮演', locale: 'zh-CN' },
  { id: 'zh_female_chanmeinv_uranus_bigtts', label: '谄媚女声 2.0', locale: 'zh-CN' },
  { id: 'zh_female_ganmaodianyin_uranus_bigtts', label: '感冒电音姐姐 2.0', locale: 'zh-CN' },
  { id: 'zh_female_jiaochuannv_uranus_bigtts', label: '娇喘女声 2.0', locale: 'zh-CN' },
  { id: 'ICL_uranus_zh_female_kefuwanjun_tob', label: '客服婉君 2.0 · 客服', locale: 'zh-CN' },
  { id: 'ICL_uranus_zh_female_yingxiaokefu_v2_tob', label: '营销小楠 2.0 · 客服', locale: 'zh-CN' },
  { id: 'ICL_uranus_zh_female_qingyingduoduo_tob', label: '轻盈朵朵 2.0', locale: 'zh-CN' },
  { id: 'ICL_uranus_zh_female_reqingaina_tob', label: '热情艾娜 2.0', locale: 'zh-CN' },
  { id: 'ICL_uranus_zh_female_wenwanshanshan_tob', label: '温婉珊珊 2.0', locale: 'zh-CN' },
]

export function voicesFor(provider: string): VoiceOption[] {
  if (provider === 'volc') return VOLC_SPEAKERS
  if (provider === 'edge') return EDGE_VOICES
  return []
}
