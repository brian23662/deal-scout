import { Listing, DealScore } from '@/types'
import { formatDealAlert, formatDealAlertHTML } from '@/lib/scoring'

export async function sendSMSAlert(listing: Listing, score: DealScore): Promise<boolean> {
  try {
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    const message = formatDealAlert(listing, score)
    const trimmed = message.length > 1500 ? message.substring(0, 1497) + '...' : message
    await twilio.messages.create({
      body: trimmed,
      from: process.env.TWILIO_FROM_NUMBER,
      to: process.env.ALERT_TO_NUMBER,
    })
    console.log(`SMS alert sent for: ${listing.title}`)
    return true
  } catch (error) {
    console.error('SMS alert failed:', error)
    return false
  }
}

export async function sendEmailAlert(listing: Listing, score: DealScore): Promise<boolean> {
  try {
    const { Resend } = require('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    const scoreEmoji = score.score >= 80 ? '🔥' : score.score >= 60 ? '⚡' : '💰'
    await resend.emails.send({
      from: 'Deal Scout <alerts@yourdomain.com>', // update with your Resend domain
      to: process.env.ALERT_TO_EMAIL!,
      subject: `${scoreEmoji} Deal Alert: ${listing.title} - $${score.profit_potential.toLocaleString()} profit`,
      html: formatDealAlertHTML(listing, score),
      text: formatDealAlert(listing, score),
    })
    console.log(`Email alert sent for: ${listing.title}`)
    return true
  } catch (error) {
    console.error('Email alert failed:', error)
    return false
  }
}

export async function sendDealAlerts(listing: Listing, score: DealScore): Promise<void> {
  await Promise.allSettled([sendSMSAlert(listing, score), sendEmailAlert(listing, score)])
}
