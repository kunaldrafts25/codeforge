'use client'

import { useState, useEffect } from 'react'

interface CountdownTimerProps {
    targetDate: Date
    onComplete?: () => void
    label?: string
}

export function CountdownTimer({ targetDate, onComplete, label }: CountdownTimerProps) {
    const [timeLeft, setTimeLeft] = useState(calculateTimeLeft())

    function calculateTimeLeft() {
        const diff = new Date(targetDate).getTime() - Date.now()
        
        if (diff <= 0) {
            return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true }
        }

        return {
            days: Math.floor(diff / (1000 * 60 * 60 * 24)),
            hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
            minutes: Math.floor((diff / 1000 / 60) % 60),
            seconds: Math.floor((diff / 1000) % 60),
            expired: false,
        }
    }

    useEffect(() => {
        const timer = setInterval(() => {
            const newTimeLeft = calculateTimeLeft()
            setTimeLeft(newTimeLeft)

            if (newTimeLeft.expired) {
                clearInterval(timer)
                onComplete?.()
            }
        }, 1000)

        return () => clearInterval(timer)
    }, [targetDate])

    if (timeLeft.expired) {
        return null
    }

    const pad = (n: number) => n.toString().padStart(2, '0')

    return (
        <div className="text-center">
            {label && <p className="text-sm text-muted-foreground mb-2">{label}</p>}
            <div className="flex items-center justify-center gap-2 font-mono text-2xl">
                {timeLeft.days > 0 && (
                    <>
                        <div className="bg-muted px-3 py-2 rounded">
                            <span className="text-3xl font-bold">{timeLeft.days}</span>
                            <span className="text-xs block text-muted-foreground">days</span>
                        </div>
                        <span className="text-muted-foreground">:</span>
                    </>
                )}
                <div className="bg-muted px-3 py-2 rounded">
                    <span className="text-3xl font-bold">{pad(timeLeft.hours)}</span>
                    <span className="text-xs block text-muted-foreground">hours</span>
                </div>
                <span className="text-muted-foreground">:</span>
                <div className="bg-muted px-3 py-2 rounded">
                    <span className="text-3xl font-bold">{pad(timeLeft.minutes)}</span>
                    <span className="text-xs block text-muted-foreground">min</span>
                </div>
                <span className="text-muted-foreground">:</span>
                <div className="bg-muted px-3 py-2 rounded">
                    <span className="text-3xl font-bold">{pad(timeLeft.seconds)}</span>
                    <span className="text-xs block text-muted-foreground">sec</span>
                </div>
            </div>
        </div>
    )
}