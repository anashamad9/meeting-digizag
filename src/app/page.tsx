"use client"

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import type { User } from "@supabase/supabase-js"
import Image from "next/image"
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns"
import {
  ArrowLeftIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Clock3Icon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  LogOutIcon,
  MailIcon,
  RefreshCwIcon,
  Trash2Icon,
  UserPlusIcon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { hasSupabaseEnv, supabase } from "@/lib/supabase"

type BookingRow = {
  id: string
  booking_date: string
  hour: number
  booked_by: string
  profiles:
    | {
        full_name: string | null
        email: string | null
      }
    | {
        full_name: string | null
        email: string | null
      }[]
    | null
}

type Notice = {
  kind: "error" | "success"
  text: string
}

type AuthStep = "email" | "login" | "signup"

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8)
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
const ROOM_TIME_ZONE = "Asia/Amman"
const SESSION_STARTED_AT_KEY = "digizag_meeting_room_session_started_at"
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const AUTH_BOOT_TIMEOUT_MS = 8000
const HR_EMAIL = "hr@digizag.com"
const LOGIN_TYPING_TEXT = "Welcome to the meeting Room"

function formatDateKey(value: Date) {
  return format(value, "yyyy-MM-dd")
}

function getDateKeyInTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value)

  const year = parts.find((part) => part.type === "year")?.value ?? "0000"
  const month = parts.find((part) => part.type === "month")?.value ?? "01"
  const day = parts.find((part) => part.type === "day")?.value ?? "01"

  return `${year}-${month}-${day}`
}

function getDisplayName(
  profile: { full_name: string | null; email: string | null } | null,
  fallbackEmail?: string | null
) {
  const fullName = profile?.full_name?.trim()
  if (fullName) {
    return fullName
  }

  const email = profile?.email ?? fallbackEmail ?? ""
  const handle = email.split("@")[0]
  if (!handle) {
    return "Unknown"
  }

  return handle
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function resolveProfile(value: BookingRow["profiles"]) {
  if (!value) {
    return null
  }

  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value
}

function toHourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`
}

function initialNameFromEmail(email?: string | null) {
  if (!email) {
    return "Employee"
  }

  return email
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function isValidEmail(email: string) {
  return /^\S+@\S+\.\S+$/.test(email)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs)

    promise
      .then((value) => {
        clearTimeout(timeoutId)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timeoutId)
        reject(error)
      })
  })
}

export default function Home() {
  const [ready, setReady] = useState(!hasSupabaseEnv)
  const [user, setUser] = useState<User | null>(null)
  const [authStep, setAuthStep] = useState<AuthStep>("email")
  const [authEmail, setAuthEmail] = useState("")
  const [authPassword, setAuthPassword] = useState("")
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState("")
  const [showAuthPassword, setShowAuthPassword] = useState(false)
  const [showAuthPasswordConfirm, setShowAuthPasswordConfirm] = useState(false)
  const [checkingEmail, setCheckingEmail] = useState(false)
  const [submittingAuth, setSubmittingAuth] = useState(false)
  const [sendingResetPassword, setSendingResetPassword] = useState(false)
  const [isRecoveryMode, setIsRecoveryMode] = useState(false)
  const [recoveryPassword, setRecoveryPassword] = useState("")
  const [recoveryPasswordConfirm, setRecoveryPasswordConfirm] = useState("")
  const [showRecoveryPassword, setShowRecoveryPassword] = useState(false)
  const [showRecoveryPasswordConfirm, setShowRecoveryPasswordConfirm] = useState(false)
  const [submittingRecoveryPassword, setSubmittingRecoveryPassword] = useState(false)

  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()))
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [loadingBookings, setLoadingBookings] = useState(false)

  const [selectedHours, setSelectedHours] = useState<number[]>([])
  const [submittingBooking, setSubmittingBooking] = useState(false)
  const [deletingBookingId, setDeletingBookingId] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [typedLoginTitle, setTypedLoginTitle] = useState("")

  const normalizedEmail = authEmail.trim().toLowerCase()
  const isRecoveryPasswordValid =
    recoveryPassword.length >= 6 &&
    recoveryPasswordConfirm.length >= 6 &&
    recoveryPassword === recoveryPasswordConfirm

  const hasRecoveryLink = useCallback(() => {
    const hash = window.location.hash.toLowerCase()
    const search = window.location.search.toLowerCase()
    return hash.includes("type=recovery") || search.includes("type=recovery")
  }, [])

  useEffect(() => {
    let index = 0
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const tick = () => {
      if (index <= LOGIN_TYPING_TEXT.length) {
        setTypedLoginTitle(LOGIN_TYPING_TEXT.slice(0, index))
        index += 1
        timeoutId = setTimeout(tick, 65)
      } else {
        timeoutId = setTimeout(() => {
          index = 0
          setTypedLoginTitle("")
          tick()
        }, 1200)
      }
    }

    tick()

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [])

  const markSessionStarted = useCallback(() => {
    localStorage.setItem(SESSION_STARTED_AT_KEY, String(Date.now()))
  }, [])

  const clearSessionStarted = useCallback(() => {
    localStorage.removeItem(SESSION_STARTED_AT_KEY)
  }, [])

  const hasSessionExpired = useCallback(() => {
    const stored = localStorage.getItem(SESSION_STARTED_AT_KEY)
    if (!stored) {
      return false
    }

    const startedAt = Number(stored)
    if (!Number.isFinite(startedAt)) {
      return false
    }

    return Date.now() - startedAt > SESSION_TTL_MS
  }, [])

  const ensureProfile = useCallback(async (authUser: User) => {
    if (!authUser.email) {
      return
    }

    await supabase.from("profiles").upsert(
      {
        id: authUser.id,
        email: authUser.email,
        full_name: initialNameFromEmail(authUser.email),
      },
      { onConflict: "id" }
    )
  }, [])

  const loadMonthBookings = useCallback(async (monthDate: Date) => {
    setLoadingBookings(true)
    try {
      const from = format(startOfMonth(monthDate), "yyyy-MM-dd")
      const to = format(endOfMonth(monthDate), "yyyy-MM-dd")

      const { data, error } = await supabase
        .from("bookings")
        .select(
          "id, booking_date, hour, booked_by, profiles:profiles!bookings_booked_by_fkey(full_name, email)"
        )
        .gte("booking_date", from)
        .lte("booking_date", to)
        .order("booking_date", { ascending: true })
        .order("hour", { ascending: true })

      if (error) {
        setNotice({ kind: "error", text: error.message })
        return
      }

      setBookings((data ?? []) as unknown as BookingRow[])
      setNotice(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load bookings."
      setNotice({ kind: "error", text: message })
    } finally {
      setLoadingBookings(false)
    }
  }, [])

  useEffect(() => {
    if (!hasSupabaseEnv) {
      return
    }

    let mounted = true
    const recoveryRequested = hasRecoveryLink()
    if (recoveryRequested) {
      setIsRecoveryMode(true)
    }

    const initializeSession = async () => {
      try {
        const { data, error } = await withTimeout(
          supabase.auth.getSession(),
          AUTH_BOOT_TIMEOUT_MS,
          "Startup timed out while checking your session. Please refresh and try again."
        )

        if (!mounted) {
          return
        }

        if (error) {
          throw error
        }

        const sessionUser = data.session?.user ?? null
        if (sessionUser && hasSessionExpired()) {
          clearSessionStarted()
          await supabase.auth.signOut()
          setUser(null)
          setNotice({ kind: "error", text: "Session expired. Please login again." })
          return
        }

        if (sessionUser) {
          const stored = localStorage.getItem(SESSION_STARTED_AT_KEY)
          if (!stored) {
            markSessionStarted()
          }
        }

        setUser(sessionUser)

        if (recoveryRequested && sessionUser) {
          setIsRecoveryMode(true)
          setNotice({ kind: "success", text: "Set a new password for your account." })
        }

        if (sessionUser) {
          await ensureProfile(sessionUser)
          await loadMonthBookings(currentMonth)
        }
      } catch (error) {
        if (!mounted) {
          return
        }

        const message =
          error instanceof Error
            ? error.message
            : "Could not initialize session. Please refresh and try again."
        setUser(null)
        setNotice({ kind: "error", text: message })
      } finally {
        if (mounted) {
          setReady(true)
        }
      }
    }

    void initializeSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      const sessionUser = session?.user ?? null

      if (event === "PASSWORD_RECOVERY") {
        setIsRecoveryMode(true)
        setNotice({ kind: "success", text: "Set a new password for your account." })
      }

      if (event === "SIGNED_IN" && hasRecoveryLink()) {
        setIsRecoveryMode(true)
        setNotice({ kind: "success", text: "Set a new password for your account." })
      }

      if (event === "SIGNED_OUT") {
        clearSessionStarted()
        setIsRecoveryMode(false)
      }

      if (event === "SIGNED_IN") {
        markSessionStarted()
      }

      if (sessionUser && hasSessionExpired()) {
        clearSessionStarted()
        await supabase.auth.signOut()
        setUser(null)
        setNotice({ kind: "error", text: "Session expired. Please login again." })
        return
      }

      setUser(sessionUser)
      setSelectedHours([])

      if (sessionUser) {
        await ensureProfile(sessionUser)
        await loadMonthBookings(currentMonth)
      } else {
        setBookings([])
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [
    clearSessionStarted,
    currentMonth,
    ensureProfile,
    hasRecoveryLink,
    hasSessionExpired,
    loadMonthBookings,
    markSessionStarted,
  ])

  useEffect(() => {
    if (!user) {
      return
    }

    void loadMonthBookings(currentMonth)
  }, [currentMonth, loadMonthBookings, user])

  useEffect(() => {
    if (!user) {
      return
    }

    const channel = supabase
      .channel("bookings-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        () => {
          void loadMonthBookings(currentMonth)
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [currentMonth, loadMonthBookings, user])

  const bookingsByDate = useMemo(() => {
    const map = new Map<string, { count: number; names: string[] }>()

    for (const booking of bookings) {
      const key = booking.booking_date
      const current = map.get(key)
      const name = getDisplayName(resolveProfile(booking.profiles))

      if (!current) {
        map.set(key, { count: 1, names: [name] })
      } else {
        current.count += 1
        if (!current.names.includes(name)) {
          current.names.push(name)
        }
      }
    }

    return map
  }, [bookings])

  const selectedDateKey = formatDateKey(selectedDate)

  const selectedDateBookings = useMemo(
    () =>
      bookings
        .filter((booking) => booking.booking_date === selectedDateKey)
        .sort((a, b) => a.hour - b.hour),
    [bookings, selectedDateKey]
  )

  const takenHours = useMemo(
    () => new Set(selectedDateBookings.map((booking) => booking.hour)),
    [selectedDateBookings]
  )

  const todayKeyInRoomTimeZone = getDateKeyInTimeZone(new Date(), ROOM_TIME_ZONE)
  const isSelectedDateInPast = selectedDateKey < todayKeyInRoomTimeZone

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(currentMonth)

    return eachDayOfInterval({
      start: startOfWeek(monthStart, { weekStartsOn: 0 }),
      end: endOfWeek(monthEnd, { weekStartsOn: 0 }),
    })
  }, [currentMonth])

  const currentUserName = initialNameFromEmail(user?.email)
  const isHrUser = user?.email?.toLowerCase() === HR_EMAIL

  const handleEmailStepSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!isValidEmail(normalizedEmail)) {
      setNotice({ kind: "error", text: "Enter a valid email address." })
      return
    }

    setCheckingEmail(true)

    const { data, error } = await supabase.rpc("account_exists", {
      input_email: normalizedEmail,
    })

    if (error) {
      setNotice({
        kind: "error",
        text:
          "Could not check email. Run the latest SQL script (account_exists function), then try again.",
      })
      setCheckingEmail(false)
      return
    }

    if (data) {
      setAuthStep("login")
      setNotice(null)
    } else {
      setAuthStep("signup")
      setNotice({ kind: "success", text: "New email detected. Create your password." })
    }

    setAuthPassword("")
    setAuthPasswordConfirm("")
    setShowAuthPassword(false)
    setShowAuthPasswordConfirm(false)
    setCheckingEmail(false)
  }

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!isValidEmail(normalizedEmail)) {
      setNotice({ kind: "error", text: "Enter a valid email address." })
      return
    }

    if (!authPassword) {
      setNotice({ kind: "error", text: "Enter your password." })
      return
    }

    if (authStep === "signup") {
      if (authPassword.length < 6) {
        setNotice({ kind: "error", text: "Password must be at least 6 characters." })
        return
      }

      if (authPassword !== authPasswordConfirm) {
        setNotice({ kind: "error", text: "Passwords do not match." })
        return
      }
    }

    setSubmittingAuth(true)

    if (authStep === "login") {
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: authPassword,
      })

      if (error) {
        setNotice({ kind: "error", text: "Invalid email or password." })
      } else {
        setNotice(null)
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password: authPassword,
      })

      if (error) {
        setNotice({ kind: "error", text: error.message })
      } else if (!data.session) {
        setAuthStep("login")
        setNotice({
          kind: "success",
          text: "Account created. Please login with your password.",
        })
      } else {
        setNotice({ kind: "success", text: "Account created and logged in." })
      }
    }

    setSubmittingAuth(false)
  }

  const handleBackToEmail = () => {
    setAuthStep("email")
    setAuthPassword("")
    setAuthPasswordConfirm("")
    setShowAuthPassword(false)
    setShowAuthPasswordConfirm(false)
    setNotice(null)
  }

  const handleForgotPassword = async () => {
    if (!isValidEmail(normalizedEmail)) {
      setNotice({ kind: "error", text: "Enter your email first, then click Forgot password." })
      return
    }

    setSendingResetPassword(true)

    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: window.location.origin,
    })

    if (error) {
      setNotice({ kind: "error", text: error.message })
    } else {
      setNotice({
        kind: "success",
        text: "Password reset link sent. Open your email, then set the new password here.",
      })
    }

    setSendingResetPassword(false)
  }

  const handleRecoveryPasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (recoveryPassword.length < 6) {
      setNotice({ kind: "error", text: "Password must be at least 6 characters." })
      return
    }

    if (recoveryPassword !== recoveryPasswordConfirm) {
      setNotice({ kind: "error", text: "Passwords do not match." })
      return
    }

    setSubmittingRecoveryPassword(true)
    try {
      const { error } = await supabase.auth.updateUser({
        password: recoveryPassword,
      })

      if (error) {
        setNotice({ kind: "error", text: error.message })
      } else {
        setIsRecoveryMode(false)
        setRecoveryPassword("")
        setRecoveryPasswordConfirm("")
        setShowRecoveryPassword(false)
        setShowRecoveryPasswordConfirm(false)
        setNotice({ kind: "success", text: "Password updated. You can continue using the app." })
        window.history.replaceState({}, document.title, window.location.pathname)
      }
    } catch {
      setNotice({ kind: "error", text: "Failed to update password. Please try again." })
    } finally {
      setSubmittingRecoveryPassword(false)
    }
  }

  const handleToggleHour = (hour: number) => {
    if (isSelectedDateInPast) {
      return
    }

    if (takenHours.has(hour)) {
      return
    }

    setSelectedHours((previous) => {
      if (previous.includes(hour)) {
        return previous.filter((item) => item !== hour)
      }

      return [...previous, hour].sort((a, b) => a - b)
    })
  }

  const handleBookHours = async () => {
    if (!user) {
      setNotice({ kind: "error", text: "Please login first." })
      return
    }

    if (isSelectedDateInPast) {
      setNotice({ kind: "error", text: "You cannot book past days." })
      return
    }

    if (selectedHours.length === 0) {
      setNotice({ kind: "error", text: "Select at least one hour." })
      return
    }

    setSubmittingBooking(true)

    const payload = selectedHours.map((hour) => ({
      booking_date: selectedDateKey,
      hour,
      booked_by: user.id,
    }))

    const { error } = await supabase.from("bookings").insert(payload)

    if (error) {
      setNotice({ kind: "error", text: error.message })
    } else {
      setNotice({ kind: "success", text: "Meeting room booked successfully." })
      setSelectedHours([])
      await loadMonthBookings(currentMonth)
    }

    setSubmittingBooking(false)
  }

  const handleRefreshBookings = async () => {
    await loadMonthBookings(currentMonth)
  }

  const handleSignOut = async () => {
    setSigningOut(true)
    setUser(null)
    setBookings([])
    setSelectedHours([])
    setAuthStep("email")
    setAuthPassword("")
    setAuthPasswordConfirm("")
    setShowAuthPassword(false)
    setShowAuthPasswordConfirm(false)
    setIsRecoveryMode(false)
    setRecoveryPassword("")
    setRecoveryPasswordConfirm("")
    setShowRecoveryPassword(false)
    setShowRecoveryPasswordConfirm(false)
    setNotice(null)
    clearSessionStarted()

    const { error } = await supabase.auth.signOut()
    if (error) {
      setNotice({ kind: "error", text: error.message })
    }
    setSigningOut(false)
  }

  const handleDeleteBooking = async (booking: BookingRow) => {
    if (!user) {
      return
    }

    if (booking.booked_by !== user.id && !isHrUser) {
      setNotice({ kind: "error", text: "You can only delete your own bookings." })
      return
    }

    setDeletingBookingId(booking.id)

    const { error } = await supabase.from("bookings").delete().eq("id", booking.id)

    if (error) {
      setNotice({ kind: "error", text: error.message })
    } else {
      setNotice({ kind: "success", text: `Deleted ${toHourLabel(booking.hour)} booking.` })
      await loadMonthBookings(currentMonth)
    }

    setDeletingBookingId(null)
  }

  if (!ready) {
    return (
      <main className="min-h-screen bg-muted/40 px-4 py-10 md:px-8">
        <div className="mx-auto max-w-7xl">
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">Loading...</CardContent>
          </Card>
        </div>
      </main>
    )
  }

  if (!hasSupabaseEnv) {
    return (
      <main className="min-h-screen bg-muted/40 px-4 py-10 md:px-8">
        <div className="mx-auto max-w-xl">
          <Card>
            <CardHeader>
              <CardTitle>DigiZag Meeting Room</CardTitle>
              <CardDescription>Supabase environment variables are missing.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>Add these variables in `.env.local`:</p>
              <p>`NEXT_PUBLIC_SUPABASE_URL`</p>
              <p>`NEXT_PUBLIC_SUPABASE_ANON_KEY`</p>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  if (!user || isRecoveryMode) {
    return (
      <main className="min-h-screen bg-muted/40 px-4 py-8 md:px-6">
        <div className="mx-auto max-w-md">
          <Card className="overflow-hidden">
            {!isRecoveryMode && (
              <div className="flex h-64 w-full items-start justify-center bg-muted/20 sm:h-72">
                <Image
                  src="/IMG_3807.jpg"
                  alt="DigiZag Meeting Room"
                  width={1284}
                  height={1680}
                  className="h-full w-auto object-contain"
                  priority
                />
              </div>
            )}
            <CardHeader>
              <CardTitle>
                {isRecoveryMode ? "DigiZag Meeting Room" : `${typedLoginTitle || " "}|`}
              </CardTitle>
              <CardDescription>
                {isRecoveryMode ? "Set a new password." : "Email + password login."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isRecoveryMode && (
                <form className="space-y-3" onSubmit={handleRecoveryPasswordSubmit}>
                  <div className="relative">
                    <input
                      type={showRecoveryPassword ? "text" : "password"}
                      placeholder="New password"
                      value={recoveryPassword}
                      onChange={(event) => setRecoveryPassword(event.target.value)}
                      autoComplete="new-password"
                      name="new_password"
                      className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 pr-24 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setShowRecoveryPassword((prev) => !prev)}
                    >
                      {showRecoveryPassword ? (
                        <span className="inline-flex items-center gap-1">
                          <EyeOffIcon className="size-3.5" />
                          Hide
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <EyeIcon className="size-3.5" />
                          View
                        </span>
                      )}
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showRecoveryPasswordConfirm ? "text" : "password"}
                      placeholder="Confirm new password"
                      value={recoveryPasswordConfirm}
                      onChange={(event) => setRecoveryPasswordConfirm(event.target.value)}
                      autoComplete="new-password"
                      name="confirm_new_password"
                      className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 pr-24 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setShowRecoveryPasswordConfirm((prev) => !prev)}
                    >
                      {showRecoveryPasswordConfirm ? (
                        <span className="inline-flex items-center gap-1">
                          <EyeOffIcon className="size-3.5" />
                          Hide
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <EyeIcon className="size-3.5" />
                          View
                        </span>
                      )}
                    </button>
                  </div>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={submittingRecoveryPassword || !isRecoveryPasswordValid}
                  >
                    <LockIcon className="size-4" />
                    {submittingRecoveryPassword ? "Updating..." : "Update Password"}
                  </Button>
                </form>
              )}

              {!isRecoveryMode && authStep === "email" && (
                <form className="space-y-3" onSubmit={handleEmailStepSubmit}>
                  <Input
                    type="email"
                    placeholder="name@digizag.com"
                    value={authEmail}
                    onChange={(event) => setAuthEmail(event.target.value)}
                    autoComplete="email"
                    name="email"
                    className="h-9 text-sm"
                  />
                  <Button type="submit" size="sm" disabled={checkingEmail}>
                    <MailIcon className="size-4" />
                    {checkingEmail ? "Checking..." : "Continue"}
                  </Button>
                  <div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={handleForgotPassword}
                      disabled={sendingResetPassword}
                    >
                      {sendingResetPassword ? "Sending reset..." : "Forgot password?"}
                    </Button>
                  </div>
                </form>
              )}

              {!isRecoveryMode && (authStep === "login" || authStep === "signup") && (
                <form className="space-y-3" onSubmit={handleAuthSubmit} autoComplete="on">
                  <Input
                    type="email"
                    value={normalizedEmail}
                    readOnly
                    autoComplete="username"
                    name="email"
                    className="h-9 text-sm"
                  />
                  <div className="relative">
                    <input
                      type={showAuthPassword ? "text" : "password"}
                      placeholder={authStep === "login" ? "Enter your password" : "Create password"}
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      autoComplete={authStep === "login" ? "current-password" : "new-password"}
                      name="password"
                      className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 pr-24 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setShowAuthPassword((prev) => !prev)}
                    >
                      {showAuthPassword ? (
                        <span className="inline-flex items-center gap-1">
                          <EyeOffIcon className="size-3.5" />
                          Hide
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <EyeIcon className="size-3.5" />
                          View
                        </span>
                      )}
                    </button>
                  </div>
                  {authStep === "signup" && (
                    <div className="relative">
                      <input
                        type={showAuthPasswordConfirm ? "text" : "password"}
                        placeholder="Confirm password"
                        value={authPasswordConfirm}
                        onChange={(event) => setAuthPasswordConfirm(event.target.value)}
                        autoComplete="new-password"
                        name="confirm_password"
                        className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 pr-24 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setShowAuthPasswordConfirm((prev) => !prev)}
                      >
                        {showAuthPasswordConfirm ? (
                          <span className="inline-flex items-center gap-1">
                            <EyeOffIcon className="size-3.5" />
                            Hide
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <EyeIcon className="size-3.5" />
                            View
                          </span>
                        )}
                      </button>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" size="sm" disabled={submittingAuth}>
                      {authStep === "login" ? <LockIcon className="size-4" /> : <UserPlusIcon className="size-4" />}
                      {submittingAuth
                        ? authStep === "login"
                          ? "Logging in..."
                          : "Creating..."
                        : authStep === "login"
                          ? "Login"
                          : "Create Account"}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={handleBackToEmail}>
                      <ArrowLeftIcon className="size-4" />
                      Change Email
                    </Button>
                  </div>
                  {authStep === "login" && (
                    <div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={handleForgotPassword}
                        disabled={sendingResetPassword}
                      >
                        {sendingResetPassword ? "Sending reset..." : "Forgot password?"}
                      </Button>
                    </div>
                  )}
                </form>
              )}
            </CardContent>
          </Card>

          {notice && (
            <div className="mt-4">
              <Alert variant={notice.kind === "error" ? "destructive" : "default"}>
                <AlertTitle>{notice.kind === "error" ? "Error" : "Done"}</AlertTitle>
                <AlertDescription>{notice.text}</AlertDescription>
              </Alert>
            </div>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-muted/40 px-3 py-4 sm:px-4 sm:py-5 md:px-6 md:py-7">
      <div className="mx-auto max-w-[1080px]">
        {notice && (
          <div className="mb-4">
            <Alert variant={notice.kind === "error" ? "destructive" : "default"}>
              <AlertTitle>{notice.kind === "error" ? "Error" : "Done"}</AlertTitle>
              <AlertDescription>{notice.text}</AlertDescription>
            </Alert>
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-[210px_500px_280px] lg:justify-center">
          <Card className="order-2 lg:order-1">
            <CardHeader>
              <div className="mb-2">
                <Image
                  src="/digizag%20logo.png"
                  alt="DigiZag Logo"
                  width={280}
                  height={96}
                  className="h-10 w-auto object-contain md:h-12"
                  priority
                />
              </div>
              <CardTitle className="text-lg sm:text-xl">DigiZag Meeting Room</CardTitle>
              <CardDescription>{currentUserName} - DigiZag</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Clock3Icon className="size-4" />
                Hourly slots
              </div>
              <div className="flex items-center gap-2">
                <CalendarIcon className="size-4" />
                Multi-hour booking enabled
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{ROOM_TIME_ZONE}</Badge>
              </div>
              <Button size="sm" variant="destructive" onClick={handleSignOut} disabled={signingOut}>
                <LogOutIcon className="size-4" />
                {signingOut ? "Signing out..." : "Sign out"}
              </Button>
            </CardContent>
          </Card>

          <Card className="order-1 mx-auto w-full max-w-[500px] lg:order-2">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base sm:text-lg">{format(currentMonth, "MMMM yyyy")}</CardTitle>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  >
                    <ChevronLeftIcon className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  >
                    <ChevronRightIcon className="size-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="overflow-hidden">
              <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-medium text-muted-foreground sm:text-[10px]">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="py-1">
                    {day}
                  </div>
                ))}
              </div>

              <div className="mt-1.5 grid grid-cols-7 gap-1">
                {calendarDays.map((day) => {
                  const key = formatDateKey(day)
                  const isInCurrentMonth = isSameMonth(day, currentMonth)
                  const isPastDay = key < todayKeyInRoomTimeZone
                  const isDaySelectable = isInCurrentMonth && !isPastDay
                  const isSelected = isSameDay(day, selectedDate)
                  const summary = bookingsByDate.get(key)

                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!isDaySelectable}
                      onClick={() => {
                        if (!isDaySelectable) {
                          return
                        }
                        setSelectedDate(day)
                        setSelectedHours([])
                      }}
                      className={[
                        "min-h-11 rounded-md border p-1 text-left transition sm:min-h-12 sm:p-1.5",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background hover:bg-muted",
                        !isDaySelectable && "cursor-not-allowed opacity-40 hover:bg-background",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <div className="text-[11px] leading-none font-semibold sm:text-xs">{format(day, "d")}</div>

                      {summary && (
                        <div className="mt-0.5 space-y-0.5">
                          <div className="text-[8px] opacity-80 sm:text-[9px]">{summary.count} booked</div>
                          <div className="space-y-px">
                            {summary.names.slice(0, 2).map((name) => (
                              <div key={`${key}-${name}`} className="truncate text-[8px] opacity-85 sm:text-[9px]">
                                {name}
                              </div>
                            ))}
                            {summary.names.length > 2 && (
                              <div className="text-[8px] opacity-80 sm:text-[9px]">+{summary.names.length - 2}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="order-3 w-full">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base sm:text-lg">{format(selectedDate, "EEE d")}</CardTitle>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={handleRefreshBookings}
                  disabled={loadingBookings}
                >
                  <RefreshCwIcon className="size-3.5" />
                  Refresh
                </Button>
              </div>
              <CardDescription>
                Select one or more hours to book, or delete your own booking.
              </CardDescription>
              {isSelectedDateInPast && (
                <p className="text-xs text-destructive">Past days cannot be booked.</p>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {HOURS.map((hour) => {
                const booking = selectedDateBookings.find((item) => item.hour === hour)
                const isBooked = Boolean(booking)
                const checked = selectedHours.includes(hour)
                const isOwnBooking = booking?.booked_by === user.id
                const canDeleteBooking = Boolean(booking && (isOwnBooking || isHrUser))
                const isDeleting = deletingBookingId === booking?.id

                if (isBooked) {
                  return (
                    <div
                      key={hour}
                      className="flex items-center justify-between rounded-md border border-amber-200/70 bg-amber-50/45 px-2 py-1.5 sm:px-2.5"
                    >
                      <span className="text-[13px] font-medium sm:text-sm">{toHourLabel(hour)}</span>

                      <div className="flex items-center gap-1.5">
                        <Badge variant="secondary">
                          {getDisplayName(resolveProfile(booking?.profiles ?? null))}
                        </Badge>
                        {canDeleteBooking && booking && (
                          <Button
                            variant="destructive"
                            size="xs"
                            onClick={() => handleDeleteBooking(booking)}
                            disabled={isDeleting}
                          >
                            <Trash2Icon className="size-3.5" />
                            {isDeleting ? "Deleting..." : "Delete"}
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                }

                return (
                  <button
                    key={hour}
                    type="button"
                    onClick={() => handleToggleHour(hour)}
                    disabled={isSelectedDateInPast}
                    className={[
                      "flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left transition sm:px-2.5",
                      checked
                        ? "border-primary/40 bg-primary/10"
                        : "border-border bg-background hover:bg-muted/60",
                      isSelectedDateInPast && "cursor-not-allowed opacity-60 hover:bg-background",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span className="text-[13px] font-medium sm:text-sm">{toHourLabel(hour)}</span>
                    <span className="text-xs text-muted-foreground">
                      {isSelectedDateInPast ? "Past day" : checked ? "Selected" : "Available"}
                    </span>
                  </button>
                )
              })}

              <Separator />

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Selected hours</span>
                <span>{selectedHours.length}</span>
              </div>

              <Button
                size="sm"
                onClick={handleBookHours}
                disabled={submittingBooking || selectedHours.length === 0 || isSelectedDateInPast}
              >
                {submittingBooking ? "Booking..." : `Book ${selectedHours.length} Hour(s)`}
              </Button>

              {loadingBookings && <p className="text-xs text-muted-foreground">Refreshing bookings...</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}
