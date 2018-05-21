const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log
} = require('cozy-konnector-libs')
const request = requestFactory({ cheerio: true, debug: true, jar: true })

const baseUrl = 'https://auchandrive.fr/drive'

module.exports = new BaseKonnector(start)

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  log('info', 'Fetching bills page')
  const $ = await request(`${baseUrl}/client/mescommandes`)
  log('info', 'Parsing list of documents')
  const bills = await parseDocuments($)
  log('debug', `Bills are :\n${bills}`)
  return
//  bills = [{filename: 'toto.pdf', fileurl: 'https://auchandrive.fr/drive/impression/imprimeanciennecommande/57406933'}]


  log('info', 'Saving data to Cozy')
  await saveBills(bills, fields.folderPath, {
    // this is a bank identifier which will be used to link bills to bank operations. These
    // identifiers should be at least a word found in the title of a bank operation related to this
    // bill. It is not case sensitive.
    identifiers: ['books']
  })
}

async function authenticate(username, password) {
  // Fetch a spefic shop to get the auchanCook="985|" cookie and avoid a systematic redirect
  // 302 to prehome
  await request({url: `${baseUrl}/mag/St-Quentin-985/`,
                 headers : {
                   'Referer': `${baseUrl}/prehome/`
                 }
                })
  await signin({
    url: `${baseUrl}/client/identification`,
    formSelector: 'form[name="formIdentification"]',
    formData: { emailValidate: username,
                passwordValidate: password,
                't-zoneid': 'identification'
              },
    validate: (statusCode, $) => {
      if ($('span[title="Me connecter"]').length === 0) {
        return true
      } else {
        log('error', 'Span[title="Me connecter"] found in page, login have failed')
        return false
      }
    }
  })
}

async function parseDocuments($) {
  let bills = scrape(
    $,
    {
      orderNumber: 'td:nth-child(1)',
      shop: 'td:nth-child(2)',
      date: {
        sel: 'td:nth-child(3)',
        parse: date => date.split(' ')[0]
      },
      amount: {
        sel: 'td:nth-child(5)',
        parse: amount => amount.split(' ')[0].replace(',','.')
      },
      status: 'td:nth-child(7)'
    },
    'table tr:not(:nth-child(1))'
  )
  // Needed to remove canceled 'Annulée' bills
  bills = bills.filter(bill => bill.status == 'Retirée')
  return bills.map(bill => ({
    ...bill,
    filename: `${bill.date}_${bill.amount.replace('.',',')}€_${bill.orderNumber}.pdf}`,
    fileUrl: `${baseUrl}/impression/imprimeanciennecommande/${bill.orderNumber}`,
    currency: '€',
    vendor: 'Auchandrive'
  }))
}
