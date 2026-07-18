import { useState, useEffect, useRef } from 'react';
import { useCargoRates, SearchParams, RateResult } from '@/hooks/useCargoRates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Plane, Ship, Clock, DollarSign, ChevronDown, ChevronUp, History, MapPin, Box, Search, ArrowRight, PlaneTakeoff, ShieldAlert } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

const POPULAR_ROUTES = [
  { origin: 'Jakarta, Indonesia', destination: 'Singapore, Singapore' },
  { origin: 'Jakarta, Indonesia', destination: 'Bangkok, Thailand' },
  { origin: 'Jakarta, Indonesia', destination: 'Tokyo, Japan' },
  { origin: 'Jakarta, Indonesia', destination: 'Dubai, UAE' },
  { origin: 'Jakarta, Indonesia', destination: 'Amsterdam, Netherlands' },
  { origin: 'Jakarta, Indonesia', destination: 'Los Angeles, USA' },
];

export default function Home() {
  const [params, setParams] = useState<SearchParams>({
    origin: '',
    destination: '',
    weight: 100,
    width: 60,
    length: 40,
    height: 40,
    quantity: 1,
  });

  // State to hold the current query parameters (for the hook)
  const [queryParams, setQueryParams] = useState<SearchParams | null>(null);

  const [showDimensions, setShowDimensions] = useState(false);
  const [recentSearches, setRecentSearches] = useState<SearchParams[]>([]);

  // Query runs only when queryParams is non-null (user clicked Search or quick-pick).
  // Changing queryParams to a new object triggers a fresh fetch automatically via queryKey.
  const { data, isLoading, isError, isFetching } = useCargoRates(queryParams);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('cargoRecentSearches');
      if (saved) {
        setRecentSearches(JSON.parse(saved));
      }
    } catch (e) {
      console.error("Failed to load recent searches", e);
    }
  }, []);

  const saveRecentSearch = (search: SearchParams) => {
    setRecentSearches(prev => {
      // Avoid exact duplicates
      const filtered = prev.filter(p => p.origin !== search.origin || p.destination !== search.destination);
      const updated = [search, ...filtered].slice(0, 5);
      localStorage.setItem('cargoRecentSearches', JSON.stringify(updated));
      return updated;
    });
  };

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!params.origin || !params.destination) return;
    // Setting a new queryParams object changes the queryKey → TanStack Query
    // automatically fires a fresh fetch. No refetch() needed.
    setQueryParams({ ...params });
    saveRecentSearch(params);
  };

  const handleQuickPick = (origin: string, destination: string) => {
    const newParams = { ...params, origin, destination };
    setParams(newParams);
    setQueryParams({ ...newParams });
    saveRecentSearch(newParams);
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getModeDetails = (mode: string) => {
    switch (mode.toLowerCase()) {
      case 'express':
      case 'air express':
        return {
          icon: <PlaneTakeoff className="h-4 w-4" />,
          variant: 'express' as const,
          label: 'Air Express'
        };
      case 'air':
        return {
          icon: <Plane className="h-4 w-4" />,
          variant: 'air' as const,
          label: 'Air Freight'
        };
      case 'lcl':
      case 'sea':
        return {
          icon: <Ship className="h-4 w-4" />,
          variant: 'lcl' as const,
          label: 'Ocean LCL'
        };
      default:
        return {
          icon: <Box className="h-4 w-4" />,
          variant: 'outline' as const,
          label: mode
        };
    }
  };

  const isSearching = isLoading || isFetching;

  return (
    <div className="min-h-screen bg-neutral-50 pb-20">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-bold text-xl tracking-tight">
            <Ship className="h-6 w-6" />
            Cargo Rate Finder
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Main Content Area */}
          <div className="lg:col-span-8 space-y-8">
            {/* Search Form Card */}
            <Card className="shadow-md border-border/50">
              <CardContent className="p-6">
                <form onSubmit={handleSearch} className="space-y-6">
                  
                  {/* Origin & Destination */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="origin" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Origin</Label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input 
                          id="origin" 
                          placeholder="e.g. Jakarta, Indonesia" 
                          className="pl-9 h-12 bg-neutral-50/50"
                          value={params.origin}
                          onChange={(e) => setParams({ ...params, origin: e.target.value })}
                          required
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="destination" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Destination</Label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input 
                          id="destination" 
                          placeholder="e.g. Singapore, Singapore" 
                          className="pl-9 h-12 bg-neutral-50/50"
                          value={params.destination}
                          onChange={(e) => setParams({ ...params, destination: e.target.value })}
                          required
                        />
                      </div>
                    </div>
                  </div>

                  {/* Weight & Quantity */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="weight" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Weight (kg)</Label>
                      <div className="relative">
                        <Input 
                          id="weight" 
                          type="number" 
                          min="1"
                          className="h-12 bg-neutral-50/50"
                          value={params.weight}
                          onChange={(e) => setParams({ ...params, weight: Number(e.target.value) })}
                          required
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">kg</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="quantity" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quantity</Label>
                      <Input 
                        id="quantity" 
                        type="number" 
                        min="1"
                        className="h-12 bg-neutral-50/50"
                        value={params.quantity}
                        onChange={(e) => setParams({ ...params, quantity: Number(e.target.value) })}
                        required
                      />
                    </div>
                  </div>

                  {/* Dimensions Collapsible */}
                  <Collapsible open={showDimensions} onOpenChange={setShowDimensions}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" className="p-0 h-auto hover:bg-transparent text-primary font-medium flex items-center gap-1.5 mt-2">
                        {showDimensions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        {showDimensions ? 'Hide Dimensions' : 'Add Dimensions (Optional)'}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-4 pt-4 border-t grid grid-cols-3 gap-4 animate-in fade-in zoom-in-95 duration-200">
                      <div className="space-y-2">
                        <Label htmlFor="length" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Length (cm)</Label>
                        <Input 
                          id="length" 
                          type="number" 
                          min="1"
                          className="h-11"
                          value={params.length || ''}
                          onChange={(e) => setParams({ ...params, length: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="width" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Width (cm)</Label>
                        <Input 
                          id="width" 
                          type="number" 
                          min="1"
                          className="h-11"
                          value={params.width || ''}
                          onChange={(e) => setParams({ ...params, width: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="height" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Height (cm)</Label>
                        <Input 
                          id="height" 
                          type="number" 
                          min="1"
                          className="h-11"
                          value={params.height || ''}
                          onChange={(e) => setParams({ ...params, height: Number(e.target.value) })}
                        />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  <Button type="submit" size="lg" className="w-full text-base font-semibold" disabled={isSearching}>
                    {isSearching ? (
                      <span className="flex items-center gap-2">
                        <div className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                        Fetching live rates...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Search className="h-5 w-5" />
                        Find Rates
                      </span>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* Results Area */}
            <div className="space-y-4">
              {isSearching ? (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2 text-muted-foreground">
                    <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    Analyzing route...
                  </h3>
                  {[1, 2].map(i => (
                    <Card key={i} className="overflow-hidden">
                      <CardContent className="p-0">
                        <div className="flex flex-col sm:flex-row">
                          <div className="p-6 flex-1 space-y-4">
                            <Skeleton className="h-6 w-32" />
                            <div className="flex items-center gap-4">
                              <Skeleton className="h-10 w-24" />
                              <Skeleton className="h-10 w-32" />
                            </div>
                          </div>
                          <div className="bg-neutral-50 p-6 sm:w-64 border-t sm:border-t-0 sm:border-l flex flex-col justify-center items-start sm:items-end gap-2">
                            <Skeleton className="h-8 w-32" />
                            <Skeleton className="h-4 w-24" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : isError ? (
                <Card className="border-destructive/50 bg-destructive/5">
                  <CardContent className="p-8 flex flex-col items-center justify-center text-center">
                    <ShieldAlert className="h-12 w-12 text-destructive mb-4" />
                    <h3 className="text-lg font-semibold mb-2">Could not reach rate service</h3>
                    <p className="text-muted-foreground mb-6">There was a problem fetching the live rates. Please try again.</p>
                    <Button onClick={() => setQueryParams(queryParams ? { ...queryParams } : null)} variant="outline">Try Again</Button>
                  </CardContent>
                </Card>
              ) : data ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-semibold tracking-tight">Available Options</h2>
                      <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
                        {data.origin} <ArrowRight className="h-3 w-3" /> {data.destination}
                      </p>
                    </div>
                    <Badge variant="secondary" className="px-3 py-1 text-sm font-medium">
                      {data.numQuotes} rates found
                    </Badge>
                  </div>
                  
                  {data.numQuotes === 0 ? (
                    <Card className="border-dashed border-2">
                      <CardContent className="p-12 flex flex-col items-center justify-center text-center">
                        <Box className="h-12 w-12 text-muted-foreground/50 mb-4" />
                        <h3 className="text-lg font-semibold mb-2">No rates found for this route</h3>
                        <p className="text-muted-foreground max-w-md">Try a different origin or destination, or adjust your cargo dimensions and weight.</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-4">
                      {data.results.map((rate, idx) => {
                        const details = getModeDetails(rate.mode);
                        return (
                          <Card key={idx} className="overflow-hidden hover:border-primary/30 transition-colors">
                            <CardContent className="p-0">
                              <div className="flex flex-col sm:flex-row">
                                <div className="p-6 flex-1 flex flex-col justify-center">
                                  <div className="flex items-center gap-2 mb-4">
                                    <Badge variant={details.variant} className="flex items-center gap-1.5 px-2.5 py-1">
                                      {details.icon}
                                      {details.label}
                                    </Badge>
                                  </div>
                                  
                                  <div className="grid grid-cols-2 gap-4">
                                    <div>
                                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
                                        <Clock className="h-3.5 w-3.5" /> Est. Transit
                                      </p>
                                      <p className="font-medium text-lg">
                                        {rate.transitMin} – {rate.transitMax} {rate.transitUnit}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
                                        <DollarSign className="h-3.5 w-3.5" /> Price Range
                                      </p>
                                      <p className="font-medium text-lg text-primary">
                                        {formatCurrency(rate.priceMin, rate.currency)} – {formatCurrency(rate.priceMax, rate.currency)}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                                <div className="bg-neutral-50 p-6 sm:w-64 border-t sm:border-t-0 sm:border-l flex flex-col justify-center items-start sm:items-end gap-3">
                                  <Button className="w-full sm:w-auto font-medium">Select Rate</Button>
                                  <p className="text-xs text-muted-foreground text-center sm:text-right w-full">Final price depends on exact cargo details.</p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        )
                      })}
                      
                      <div className="text-center pt-4">
                        <a href="https://freightos.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
                          {data.attribution} <Box className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {/* Sidebar Area */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* Popular Routes */}
            <Card>
              <CardContent className="p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <PlaneTakeoff className="h-4 w-4 text-primary" />
                  Popular Routes
                </h3>
                <div className="flex flex-wrap gap-2">
                  {POPULAR_ROUTES.map((route, i) => (
                    <button
                      key={i}
                      onClick={() => handleQuickPick(route.origin, route.destination)}
                      className="text-left text-sm bg-neutral-100 hover:bg-neutral-200 text-neutral-700 px-3 py-2 rounded-lg transition-colors border border-transparent hover:border-neutral-300"
                    >
                      <div className="flex items-center gap-1.5 font-medium text-neutral-900">
                        {route.origin.split(',')[0]} <ArrowRight className="h-3 w-3 text-neutral-400" /> {route.destination.split(',')[0]}
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Recent Searches */}
            {recentSearches.length > 0 && (
              <Card>
                <CardContent className="p-6">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <History className="h-4 w-4 text-primary" />
                    Recent Searches
                  </h3>
                  <div className="space-y-3">
                    {recentSearches.map((search, i) => (
                      <div key={i} className="group relative">
                        {i > 0 && <Separator className="mb-3" />}
                        <button
                          onClick={() => {
                            setParams(search);
                            setQueryParams({ ...search });
                          }}
                          className="w-full text-left p-2 -mx-2 rounded-md hover:bg-neutral-50 transition-colors"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-foreground truncate pr-2">
                              {search.origin.split(',')[0]} <ArrowRight className="inline-block h-3 w-3 text-muted-foreground mx-0.5" /> {search.destination.split(',')[0]}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-3">
                            <span className="flex items-center gap-1">
                              <Box className="h-3 w-3" /> {search.weight}kg
                            </span>
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> Qty: {search.quantity}
                            </span>
                          </div>
                        </button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Trust Badges / Info */}
            <Card className="bg-primary text-primary-foreground border-transparent">
              <CardContent className="p-6">
                <h3 className="font-semibold text-lg mb-2">Why use Cargo Rate Finder?</h3>
                <ul className="space-y-3 text-sm text-primary-foreground/90 mt-4">
                  <li className="flex gap-2">
                    <div className="mt-0.5 bg-primary-foreground/20 p-1 rounded-full shrink-0"><Clock className="h-3 w-3" /></div>
                    <span>Real-time estimates across major freight forwarding partners.</span>
                  </li>
                  <li className="flex gap-2">
                    <div className="mt-0.5 bg-primary-foreground/20 p-1 rounded-full shrink-0"><Ship className="h-3 w-3" /></div>
                    <span>Compare Air, Sea LCL, and Express options instantly.</span>
                  </li>
                  <li className="flex gap-2">
                    <div className="mt-0.5 bg-primary-foreground/20 p-1 rounded-full shrink-0"><DollarSign className="h-3 w-3" /></div>
                    <span>Transparent pricing ranges with no hidden fee surprises.</span>
                  </li>
                </ul>
              </CardContent>
            </Card>

          </div>
        </div>
      </main>
    </div>
  );
}
