process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://04dc6318a36a4c3ba36df5ce0d1f5a26:27db5a240de4450683db84574b8aa3c6@sentry.cozycloud.cc/49'
const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log
} = require('cozy-konnector-libs')
const request = requestFactory({
  cheerio: true,
  debug: false,
  jar: true
})
const html2pdf = require('./html2pdf')
const pdf = require('pdfjs')
const moment = require('moment')
moment.locale('fr')

const baseUrl = 'https://www.auchandrive.fr/drive'

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  log('info', 'Fetching bills page')
  const $ = await request(`${baseUrl}/client/mescommandes`)
  log('info', 'Parsing list of documents')
  const bills = await parseDocuments($)
  log('info', `${bills.length} bills has been found`)
  log('info', 'Saving data to Cozy')
  await saveBills(bills, fields.folderPath, {
    identifiers: ['AUCHAN']
  })
}

async function authenticate(username, password) {
  // Fetch a spefic shop to get the auchanCook="985|" cookie and avoid a systematic redirect
  // 302 to prehome
  await request({
    url: `${baseUrl}/mag/St-Quentin-985/`,
    headers: {
      Referer: `${baseUrl}/prehome/`
    }
  })
  await signin({
    url: `${baseUrl}/client/identification`,
    formSelector: 'form[name="formIdentification"]',
    formData: {
      emailValidate: username,
      passwordValidate: password,
      't-zoneid': 'identification'
    },
    validate: (statusCode, $) => {
      if ($('span[title="Me connecter"]').length === 0) {
        return true
      } else {
        log(
          'error',
          'Span[title="Me connecter"] found in page, login have failed'
        )
        return false
      }
    }
  })
}

async function parseDocuments($) {
  const rawBills = scrape(
    $,
    {
      orderNumber: 'td:nth-child(1)',
      shop: 'td:nth-child(2)',
      date: {
        sel: 'td:nth-child(3)',
        parse: date => moment(date.split(' ')[0], 'L')
      },
      amount: {
        sel: 'td:nth-child(5)',
        parse: amount => parseFloat(amount.split(' ')[0].replace(',', '.'))
      },
      rawAmount: {
        sel: 'td:nth-child(5)',
        parse: amount => amount.replace(' ', '')
      },
      status: 'td:nth-child(7)'
    },
    'table tr:not(:nth-child(1))'
  )
  const bills = rawBills
    .filter(bill => bill.status == 'Retirée')
    .map(async bill => {
      const url = `${baseUrl}/impression/imprimeanciennecommande/${
        bill.orderNumber
      }`
      const $ = await request(url)
      const products = scrapeDetails($)
      const filestream = await billURLToStream(url, $)
      return {
        amount: bill.amount,
        products: products,
        filestream: filestream,
        filename: `${bill.date.format('YYYY-MM-DD')}_${bill.rawAmount}_${
          bill.orderNumber
        }.pdf`,
        date: bill.date.toDate(),
        currency: '€',
        vendor: 'auchandrive'
      }
    })
  return bills
}

function scrapeDetails($) {
  const products = scrape(
    $,
    {
      title: {
        sel: 'td:nth-child(1)'
      },
      number: {
        sel: `td[class='qte']`,
        parse: number => parseFloat(number)
      },
      priceByUnit: {
        sel: 'td:nth-child(3)',
        parse: amount => parseFloat(amount.split(' ')[0].replace(',', '.'))
      },
      price: {
        sel: 'td:nth-child(7)',
        parse: amount => parseFloat(amount.split(' ')[0].replace(',', '.'))
      }
    },
    'div[class="liste-courses"] table tr:not(:nth-child(1))'
  )
  log('debug', `${products.length} products found`)
  if (products.length > 0) {
    log('debug', `First is : ${products[0]}`)
  }
  return products
}

async function billURLToStream(url, $) {
  var doc = new pdf.Document()
  const cell = doc.cell({ paddingBottom: 0.5 * pdf.cm }).text()
  cell.add(
    'Généré automatiquement par le connecteur Cozy AuchanDrive depuis la page ',
    {
      font: require('pdfjs/font/Helvetica-Bold'),
      fontSize: 14
    }
  )
  cell.add(url, {
    link: url,
    color: '0x0000FF'
  })
  html2pdf($, doc, $('body'), { baseURL: url })
  doc.end()
  return doc
}
