/**
 * (c) Kohei Eguchi
 */

const pkg = require('../package.json')

import { JSDOM } from 'jsdom'

import axios, { AxiosRequestConfig } from 'axios'
import axiosCookieJarSupport from '@3846masa/axios-cookiejar-support'
import tough from 'tough-cookie'
import FormData from 'form-data'

axiosCookieJarSupport(axios)

import { IncomingWebhook } from '@slack/client'

const Config = {
  KOT: {
    ID: process.env.K2S_KOT_ID,
    Password: process.env.K2S_KOT_PASSWORD
  },
  Slack: {
    IncomingWebhookURL: process.env.K2S_SLACK_IW_URL
  }
}

class KOT {
  private jar: tough.CookieJar
  private serverURL: string
  private topURL?: string

  constructor (server = 'https://s3.kingtime.jp') {
    this.jar = new tough.CookieJar()
    this.serverURL = server
  }

  request (config: AxiosRequestConfig) {
    return axios.request({
      ...config,
      jar: this.jar,
      withCredentials: true,
      baseURL: this.serverURL,
      headers: {
        ...(config.headers || {}),
        'User-Agent': `Mozilla/5.0 (Node; ${pkg.name}/${pkg.version}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36`
      }
    })
  }

  async signin (id: string, password: string) {
    const { data: signin } = await this.request({
      method: 'get',
      url: '/admin'
    })

    const { window: { document: sd } } = new JSDOM(signin)
    const form = sd.querySelector('form')
    if (!form) {
      console.dir(signin)
      throw new Error(`No Form.`)
    }

    const option: AxiosRequestConfig = {}
    option.method = form.method
    option.url = form.action

    const fd = new FormData()
    fd.append('login_id', id)
    fd.append('login_password', password)

    for (const el of form.elements) {
      const fel = el as HTMLFormElement
      if (fel.type === 'hidden' || fel.name === 'action_id') {
        fd.append(fel.name, fel.value)
      }
      continue
    }

    option.data = fd
    option.headers = fd.getHeaders()
    option.maxRedirects = 0

    const r = await this.request(option)

    const { window: { document: ad } } = new JSDOM(r.data)

    // Failure
    const lm = ad.querySelector('.login_form_message')
    if (lm) {
      throw new Error((<HTMLDivElement>lm).innerText)
    }

    // Success
    const refresh = ad.querySelector(`meta[http-equiv="refresh"]`)
    if (refresh) {
      const e = (<HTMLMetaElement>refresh)
      this.topURL = e.content.split('URL=')[1]
      return
    }

    throw new Error('Unexpected')
  }

  async in () {
    if (!this.topURL) throw new Error('Please login.')

    const { data } = await this.request({ url: this.topURL })

    const { window: { document } } = new JSDOM(data)

    const o = Array.from(
      document.querySelectorAll('.htBlock-scrollTable_day > p')
    )
      .map(p => p as HTMLParagraphElement)
      .map(p => {
        const text = p.textContent
        if (!text) throw null
        const [month, _] = text.split('/')
        const [date] = _.split('（')

        const pa = p!.parentNode!.parentNode
        if (!pa) throw new Error()

        return [pa, month, date] as [HTMLParagraphElement, string, string]
      })
      .reduce((t, [el, _, date]) => {
        t[parseInt(date, 10)] = el
        return t
      }, {} as {[k: string]: HTMLElement})
    const r = Object.entries(o)
      .map(([k, v]) => {
        // day, elem, timerecord
        return [k, v, v.querySelector('[data-ht-sort-index="START_TIMERECORD"] > p')] as [string, HTMLElement, HTMLElement?]
      })
      .map(([k,v,e]): [string, HTMLElement, string?, string?] => {
        if (!e) throw new Error(`Unexpected...`)

        const s = e.querySelector('span')
        if (!s) return [k,v]

        const type = s!.textContent as string
        const [,time] = e.textContent!.split(type)

        return [k,v,type.trim(),time.trim()]
      })
      .reduce((pv, [key,,type = null, time = null]) => {
        pv[key] = null
        if (type && time) pv[key] = [type, time]
        return pv
      }, {} as {[k: string]: [string, string] | null})

    return r
  }

  async todayIn () {
    const d = await this.in()
    return d[(new Date()).getDate()]
  }
}

class WHConsole {
  send (...args: any[]) { console.dir(args[0].attachments[0]) }
}

async function main () {
  if (!Config.KOT.ID || !Config.KOT.Password) throw new Error(`Please give ID/PW of KOT.`)  
  const webhook = Config.Slack.IncomingWebhookURL ? new IncomingWebhook(Config.Slack.IncomingWebhookURL) : new WHConsole()

  const kot = new KOT()
  await kot.signin(Config.KOT.ID, Config.KOT.Password)

  const todayIn = await kot.todayIn()
  if (todayIn) {
    const date = new Date()
    const [h,m] = todayIn[1].split(':')
    date.setHours(parseInt(h))
    date.setMinutes(parseInt(m))
    const attachment = {
      "fallback": `出社ed, ${todayIn[0]} ${todayIn[1]}`,
      "color": "#7d449b",
      "pretext": "出社ed",
      "title": todayIn[0],
      "ts": (date.getTime() / 1000).toString(),
      "footer": "King of Time",
      "footer_icon": "https://www.kingtime.jp/wp-content/themes/king-of-time/favicon.ico"
    }

    webhook.send({ attachments: [attachment] })
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
